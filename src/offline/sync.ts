import { api } from "../api";
import { getOutbox, clearOutbox, setMapping, getMapping, putTaskLocal, removeTaskLocal, db } from "./db";

// Variable para evitar sincronizaciones simultáneas
let isSyncing = false;

export async function syncNow() {
    // Evitar múltiples sincronizaciones al mismo tiempo
    if (!navigator.onLine || isSyncing) return;
    
    isSyncing = true;

    try {
        const ops = await getOutbox();
        if (!ops.length) return;

        const successfulOps: string[] = [];
        const processedClientIds = new Set(); // Para evitar duplicados

        for (const op of ops) {
            // Verificar si ya procesamos esta tarea (por clientId)
            if (processedClientIds.has(op.clientId)) {
                console.log(`Skipping duplicate operation for clientId: ${op.clientId}`);
                successfulOps.push(op.id); // Marcar como exitoso para eliminarlo
                continue;
            }

            try {
                if (op.op === "create") {
                    const { data } = await api.post("/tasks", {
                        title: op.data.title,
                        description: op.data.description || "",
                        status: op.data.status || "Pendiente"
                    });
                    
                    const serverId = data.task?._id || data._id || data.id;
                    if (serverId) {
                        await setMapping(op.clientId, serverId);
                        successfulOps.push(op.id);
                        processedClientIds.add(op.clientId); // Registrar como procesado
                    }
                    
                } else if (op.op === "update") {
                    const serverId = op.serverId || await getMapping(op.clientId || "");
                    
                    if (serverId) {
                        await api.put(`/tasks/${serverId}`, op.data);
                        successfulOps.push(op.id);
                        processedClientIds.add(op.clientId);
                    }
                    
                } else if (op.op === "delete") {
                    const serverId = op.serverId || await getMapping(op.clientId || "");
                    
                    if (serverId) {
                        await api.delete(`/tasks/${serverId}`);
                        await removeTaskLocal(serverId);
                        successfulOps.push(op.id);
                        processedClientIds.add(op.clientId);
                    }
                }
            } catch (error) {
                console.error(`Error syncing operation ${op.id}:`, error);
                
                // Si es error 409 (conflicto) o 400 (bad request), probablemente es duplicado
                if (error.response?.status === 409 || error.response?.status === 400) {
                    successfulOps.push(op.id); // Eliminar la operación conflictiva
                    processedClientIds.add(op.clientId);
                }
            }
        }

        // Limpiar solo las operaciones exitosas o conflictivas
        if (successfulOps.length > 0) {
            const tx = (await db).transaction("outbox", "readwrite");
            const store = tx.objectStore("outbox");
            
            for (const opId of successfulOps) {
                await store.delete(opId);
            }
            await tx.done;
            
            console.log(`Synced ${successfulOps.length} operations`);
        }
    } catch (error) {
        console.error('Error during sync process:', error);
    } finally {
        isSyncing = false;
    }
}

export function setupOnlineSync() {
    const handleOnline = async () => {
        // Pequeño delay para asegurar que la conexión esté estable
        setTimeout(() => {
            syncNow().catch(console.error);
        }, 1000);
    };

    window.addEventListener("online", handleOnline);
    
    // Sincronizar periódicamente cada 30 segundos (pero solo si no está sincronizando)
    setInterval(() => {
        if (navigator.onLine && !isSyncing) {
            syncNow().catch(console.error);
        }
    }, 30000);
}

// Función para verificar si hay operaciones duplicadas en el outbox
export async function cleanupDuplicateOperations() {
    const ops = await getOutbox();
    const clientIdMap = new Map();
    const duplicates: string[] = [];

    for (const op of ops) {
        if (clientIdMap.has(op.clientId)) {
            // Si ya existe una operación para este clientId, marcar como duplicada
            duplicates.push(op.id);
        } else {
            clientIdMap.set(op.clientId, op.id);
        }
    }

    // Eliminar duplicados
    if (duplicates.length > 0) {
        const tx = (await db).transaction("outbox", "readwrite");
        const store = tx.objectStore("outbox");
        
        for (const opId of duplicates) {
            await store.delete(opId);
        }
        await tx.done;
        
        console.log(`Cleaned up ${duplicates.length} duplicate operations`);
    }
}