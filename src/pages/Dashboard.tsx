import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../offline/db";
import { syncNow, setupOnlineSync } from "../offline/sync";

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: "Pendiente" | "En Progreso" | "Completada";
  clientId?: string; // ← CORREGIDO: clienteId → clientId
  createdAt?: string;
  deleted?: boolean;
};

type Status = "Pendiente" | "En Progreso" | "Completada";

function normalizeTask(x: any): Task {
  return {
    _id: String(x?._id ?? x?.id),
    title: String(x?.title ?? "(sin título)"),
    description: x?.description ?? "",
    status:
      x?.status === "Completada" ||
      x?.status === "En Progreso" ||
      x?.status === "Pendiente"
        ? x.status
        : "Pendiente",
    clientId: x?.clientId, // ← CORREGIDO: clienteId → clientId
    createdAt: x?.createdAt,
    deleted: !!x?.deleted,
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));
    setupOnlineSync();

    const on = () => setOnline(true);
    const off = () => setOnline(false);
    
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    (async () => {
      const local = await getAllTasksLocal();
      if (local?.length) setTasks(local.map(normalizeTask));
      
      await loadFromServer();
      await syncNow();
      await loadFromServer();  
    })();

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function loadFromServer() {
    try {
      const { data } = await api.get("/tasks");
      const raw = Array.isArray(data?.items) ? data.items : [];
      const list = raw.map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // si falla, queda lo que haya en cache
    } finally {
      setLoading(false);  
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const desc = description.trim();
    if (!t) return;

    const clientId = crypto.randomUUID(); // ← CORREGIDO
    const localTask = normalizeTask({
      id: clientId, // ← CORREGIDO
      title: t,
      description: desc,
      status: "Pendiente",
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);
    setTitle("");
    setDescription("");

    if (!navigator.onLine) {
      const op: OutboxOp = {
        id: "op-" + clientId, // ← CORREGIDO
        op: "create",
        clientId, // ← CORREGIDO: clienteId → clientId
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
      return;
    }

    try {
      const { data } = await api.post("/tasks", { 
        title: t, 
        description: desc 
      }); 
      const created = normalizeTask(data?.task ?? data);
      setTasks((prev) => prev.map((x) => (x._id === clientId ? created : x))); // ← CORREGIDO
      await putTaskLocal(created);
    } catch {
      const op: OutboxOp = {
        id: "po-" + clientId, // ← CORREGIDO
        op: "create",
        clientId, // ← CORREGIDO: clienteId → clientId
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
    }
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingTitle("");
    setEditingDescription("");
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    const newDesc = editingDescription.trim();
    if (!newTitle) return;

    const before = tasks.find((t) => t._id === taskId);
    const patched = { ...before, title: newTitle, description: newDesc } as Task;
    setTasks((prev) => prev.map((t) => t._id === taskId ? patched : t));
    await putTaskLocal(patched);
    setEditingId(null);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        clientId: taskId, // ← CORREGIDO: clienteId → clientId
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, { 
        title: newTitle, 
        description: newDesc 
      });
    } catch {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        serverId: taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
    }
  }
  
  async function hadleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: task._id,
        clientId: task.clientId, // ← CORREGIDO: clienteId → clientId
        data: { status: newStatus },
        ts: Date.now(),
      });
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: task._id,
        data: { status: newStatus },
        ts: Date.now(),
      });
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    if (!navigator.onLine) {
      await queue({
        id: "del-" + taskId,
        op: "delete",
        serverId: taskId,
        ts: Date.now(),
      });
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.href = "/";
  }

  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((t) => (t.title || "").toLowerCase().includes(s));
    }
    if (filter === "active") list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return list;
  }, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

  return (
    <div className="wrap">
      <header className="topbar">
        <h1>TAREAS</h1>
        <button className="btn btn-logout" onClick={logout}>Salir</button>
      </header>

      <main className="dashboard-content">
        
        <div className="controls-and-stats">
          
          <form className="add-compact" onSubmit={addTask}>
            <div className="input-group">
              <input
                className="input-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título"
                required
              />
              <textarea
                className="input-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descripción"
                rows={1}
              />
            </div>
            <button className="btn btn-add">Añadir Tarea</button>
          </form>

          <div className="stats-card">
            <div className="stats-grid">
              <div className="stat-item total">
                <span>Total</span>
                <strong>{stats.total}</strong>
              </div>
              <div className="stat-item done">
                <span>Hechas</span>
                <strong>{stats.done}</strong>
              </div>
              <div className="stat-item">
                <span>Pendientes</span>
                <strong>{stats.pending}</strong>
              </div>

              <div>
                <span 
                  className="badge" 
                  style={{
                    marginLeft: 8, 
                    backgroundColor: online ? "#1f6feb" : "violet"
                  }}
                >
                  {online ? "Online" : "Offline"}
                </span>
              </div>
            </div>
          </div>
          
          <div className="toolbar-compact">
            <input
              className="input-search"
              placeholder="Buscar por titulo o descripcion"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="filters-group">
              <button
                className={`btn-filter ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
                type="button"
              >
                Todas
              </button>
              <button
                className={`btn-filter ${filter === "active" ? "active" : ""}`}
                onClick={() => setFilter("active")}
                type="button"
              >
                Activas
              </button>
              <button
                className={`btn-filter ${filter === "completed" ? "active" : ""}`}
                onClick={() => setFilter("completed")}
                type="button"
              >
                Hechas
              </button>
            </div>
          </div>

        </div> 

        {loading ? (
          <p className="loading-message">Cargando tareas</p>
        ) : filtered.length === 0 ? (
          <p className="empty-message">No hay tareas que mostrar</p>
        ) : (
          <ul className="task-list">
            {filtered.map((t) => (
              <li
                key={t._id}
                className={`task-item ${t.status === "Completada" ? "done" : ""}`}
              >
                <select
                  value={t.status}
                  onChange={(e) => hadleStatusChange(t, e.target.value as Status)}
                  className="status-select"
                  title="Estado"
                >
                  <option value="Pendiente">Pendiente</option>
                  <option value="En Progreso">En Progreso</option>
                  <option value="Completada">Completada</option>
                </select>

                <label className="task-check-label">
                  <input
                    type="checkbox"
                    checked={t.status === "Completada"}
                    onChange={() => hadleStatusChange(
                      t, 
                      t.status === "Completada" ? "Pendiente" : "Completada"
                    )}
                  />
                </label>

                {editingId === t._id ? (
                  <div className="task-edit-form">
                    <input
                      className="edit-input edit-title"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      placeholder="Título"
                    />
                    <textarea
                      className="edit-input edit-desc"
                      value={editingDescription}
                      onChange={(e) => setEditingDescription(e.target.value)}
                      placeholder="Descripción"
                      rows={2}
                    />
                    <div className="edit-actions">
                      <button 
                        className="btn" 
                        onClick={() => saveEdit(t._id)}
                      >
                        Guardar
                      </button>
                      <button 
                        className="btn btn-cancel" 
                        onClick={cancelEdit}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="task-info">
                    <span className="task-title" onDoubleClick={() => startEdit(t)}>
                      {t.title || "(sin título)"}
                    </span>
                    {t.description && (
                      <p className="task-description">{t.description}</p>
                    )}
                  </div>
                )}

                {editingId !== t._id && (
                  <div className="task-actions">
                    <button 
                      className="icon-btn edit-btn" 
                      title="Editar" 
                      onClick={() => startEdit(t)}
                    >
                      ✏️
                    </button>
                    <button 
                      className="icon-btn" 
                      title="Eliminar" 
                      onClick={() => removeTask(t._id)}
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}