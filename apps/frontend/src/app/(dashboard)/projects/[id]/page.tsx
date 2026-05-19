'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWebsocket } from '@/hooks/useWebsocket';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, GripVertical, AlertCircle } from 'lucide-react';

const COLUMNS = [
  { id: 'todo', title: 'To Do', color: 'bg-slate-200 dark:bg-slate-800' },
  { id: 'in_progress', title: 'In Progress', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' },
  { id: 'in_review', title: 'In Review', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' },
  { id: 'done', title: 'Done', color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
];

export default function KanbanBoard({ params }: { params: { id: string } }) {
  const [tasks, setTasks] = useState<Record<string, any[]>>({
    todo: [], in_progress: [], in_review: [], done: []
  });
  const [project, setProject] = useState<any>(null);
  
  // Create task modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  
  const token = typeof window !== 'undefined' ? 
    document.cookie.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1] || null : null;

  const { isConnected, lastMessage } = useWebsocket(token);

  const fetchTasks = async () => {
    try {
      const data = await api.get(`/projects/${params.id}/tasks`);
      // API returns grouped tasks
      setTasks({
        todo: data.todo || [],
        in_progress: data.in_progress || [],
        in_review: data.in_review || [],
        done: data.done || []
      });
    } catch (e) {
      console.error(e);
    }
  };

  const fetchProject = async () => {
    try {
      const data = await api.get(`/projects/${params.id}`);
      setProject(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchProject();
    fetchTasks();
  }, [params.id]);

  // Handle real-time WebSocket updates
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.project_id === params.id) {
      if (lastMessage.type === 'task_created' || lastMessage.type === 'task_updated') {
        // Re-fetch to guarantee consistency on collaborative edits
        fetchTasks();
      }
    }
  }, [lastMessage, params.id]);

  const onDragEnd = async (result: any) => {
    if (!result.destination) return;

    const { source, destination, draggableId } = result;

    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    // Optimistic UI update
    const sourceCol = [...tasks[source.droppableId]];
    const destCol = source.droppableId === destination.droppableId ? sourceCol : [...tasks[destination.droppableId]];
    
    const [movedTask] = sourceCol.splice(source.index, 1);
    movedTask.status = destination.droppableId;
    destCol.splice(destination.index, 0, movedTask);

    setTasks(prev => ({
      ...prev,
      [source.droppableId]: sourceCol,
      [destination.droppableId]: destCol
    }));

    // Persist change
    try {
      await api.patch(`/projects/${params.id}/tasks/${draggableId}`, {
        status: destination.droppableId
      });
    } catch (err) {
      console.error(err);
      // Revert on error
      fetchTasks();
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    
    try {
      await api.post(`/projects/${params.id}/tasks`, {
        title: newTaskTitle,
        priority: 'medium'
      });
      setNewTaskTitle('');
      setIsModalOpen(false);
      // Wait for WS to trigger refetch, or just refetch manually
      fetchTasks();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-100 dark:bg-slate-950/50">
      <div className="px-8 py-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{project?.name || 'Loading...'}</h1>
            {isConnected ? (
              <span className="flex items-center text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full"><span className="w-2 h-2 rounded-full bg-green-500 mr-1 animate-pulse"></span> Live</span>
            ) : (
              <span className="flex items-center text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full"><AlertCircle className="w-3 h-3 mr-1" /> Disconnected</span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">{project?.description}</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center gap-2 max-w-fit"
        >
          <Plus className="w-4 h-4" />
          Add Task
        </button>
      </div>

      <div className="flex-1 overflow-x-auto p-8">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-6 h-full items-start">
            {COLUMNS.map(col => (
              <div key={col.id} className="w-80 shrink-0 flex flex-col max-h-full">
                <div className={`px-4 py-3 rounded-t-xl font-semibold text-sm ${col.color}`}>
                  {col.title} <span className="ml-2 opacity-60 text-xs font-normal">{tasks[col.id]?.length || 0}</span>
                </div>
                
                <Droppable droppableId={col.id}>
                  {(provided, snapshot) => (
                    <div 
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto p-3 rounded-b-xl border-x border-b border-slate-200 dark:border-slate-800 transition-colors ${snapshot.isDraggingOver ? 'bg-slate-200/50 dark:bg-slate-800/50' : 'bg-slate-50 dark:bg-slate-900/50'}`}
                      style={{ minHeight: '150px' }}
                    >
                      {tasks[col.id]?.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 mb-3 group ${snapshot.isDragging ? 'shadow-xl scale-105 ring-2 ring-indigo-500' : 'hover:border-indigo-300 dark:hover:border-indigo-500'} transition-all`}
                            >
                              <div className="flex items-start gap-2">
                                <div {...provided.dragHandleProps} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity mt-1 cursor-grab active:cursor-grabbing">
                                  <GripVertical className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                  <h4 className="font-medium text-slate-900 dark:text-slate-100">{task.title}</h4>
                                  <div className="flex items-center justify-between mt-3">
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                      task.priority === 'high' || task.priority === 'urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                    }`}>
                                      {task.priority}
                                    </span>
                                    {task.assignee_name && (
                                      <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold" title={task.assignee_name}>
                                        {task.assignee_name.charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateTask} className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-xl font-bold">Add New Task</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Task Title</label>
                <input 
                  type="text" 
                  className="input-field" 
                  autoFocus
                  required
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  placeholder="e.g. Design Landing Page"
                />
              </div>
            </div>
            <div className="p-6 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
              <button 
                type="button" 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors"
              >
                Create Task
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
