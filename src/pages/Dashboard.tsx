import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";


type Task = {
  _id: string;
  title: string;
  description?: string;
  status: "Pendiente" | "En Progreso" | "Completada";
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
};

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
    clienteId: x?.clienteId,
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

  useEffect(() => {
    setAuth(localStorage.getItem("token"));
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);
    try {
      const { data } = await api.get("/tasks");
      const raw = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setTasks(raw.map(normalizeTask));
    } finally {
      setLoading(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const { data } = await api.post("/tasks", { 
      title: t, 
      description: description.trim() 
    });

    const created = normalizeTask(data?.task ?? data);
    setTasks((prev) => [created, ...prev]);
    setTitle("");
    setDescription("");
  }

  async function toggleTask(task: Task) {
    const newStatus = task.status === "Completada" ? "Pendiente" : "Completada";
    const updated: Task = {
      _id: task._id,
      title: task.title,
      description: task.description,
      status: newStatus,
      clienteId: task.clienteId,
      createdAt: task.createdAt,
      deleted: task.deleted
    };
    
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    
    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      setTasks((prev) => prev.map((x) => (x._id === task._id ? task : x)));
    }
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description || "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingTitle("");
    setEditingDescription("");
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    if (!newTitle) return;
    
    const before = tasks.find((t) => t._id === taskId);
    setTasks((prev) => prev.map((t) => 
      t._id === taskId ? { 
        ...t, 
        title: newTitle, 
        description: editingDescription 
      } : t
    ));
    
    setEditingId(null);
    try {
      await api.put(`/tasks/${taskId}`, { 
        title: newTitle, 
        description: editingDescription 
      });
    } catch {
      if (before) setTasks((prev) => prev.map((t) => (t._id === taskId ? before : t)));
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
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
          
          {/* Formulario de Añadir Tarea*/}
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

          {/* Estadísticas Visibles */}
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
            </div>
          </div>
          
          {/* Barra de Herramientas (Búsqueda y Filtros) */}
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


        {/* Lista de Tareas */}
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
                <label className="task-check-label">
                  <input
                    type="checkbox"
                    checked={t.status === "Completada"}
                    onChange={() => toggleTask(t)}
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
                    <button className="icon-btn edit-btn" title="Editar" onClick={() => startEdit(t)}>
                      ✏️
                    </button>
                    <button className="icon-btn" title="Eliminar" onClick={() => removeTask(t._id)}>
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