'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useWebsocket } from '@/hooks/useWebsocket';
import { DragDropContext, Droppable, Draggable, DroppableProvided, DroppableStateSnapshot } from '@hello-pangea/dnd';
import { Plus, GripVertical, AlertCircle, Pencil, Lock, Users } from 'lucide-react';
import ProjectDialog from '@/components/ProjectDialog';
import ProjectPeopleDialog from '@/components/ProjectPeopleDialog';
import TaskDetailModal, { CurrentUser } from '@/components/TaskDetailModal';
import BoardFilters, { EMPTY_BOARD_FILTERS, isFiltering, type BoardFilterValues } from '@/components/BoardFilters';
import { buildQuery } from '@/lib/query';
import type { Member } from '@/lib/members';
import { listLabels, type Label } from '@/lib/labels';
import LabelChip from '@/components/LabelChip';
import TaskForm from '@/components/TaskForm';
import Dialog from '@/components/ui/Dialog';
import { messageOf, useToast } from '@/components/ui/feedback';
import { ErrorBlock } from '@/components/ui/states';
import { EMPTY_DRAFT, STATUSES, newTaskBody, priorityLabel, type TaskDraft } from '@/lib/tasks';

const COLUMN_COLORS: Record<(typeof STATUSES)[number]['value'], string> = {
  todo: 'bg-slate-200 dark:bg-slate-800',
  in_progress: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  in_review: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300',
  done: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
};

const COLUMNS = STATUSES.map((s) => ({ id: s.value, title: s.label, color: COLUMN_COLORS[s.value] }));

export default function KanbanBoard() {
  // Next 15+ passes `params` to pages as a Promise, so read the route param with the hook instead.
  const params = useParams<{ id: string }>();
  const [tasks, setTasks] = useState<Record<string, any[]>>({
    todo: [], in_progress: [], in_review: [], done: []
  });
  const [project, setProject] = useState<any>(null);
  // The board sends each column's first page; these say how many match in all and how to get more.
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [loadingColumn, setLoadingColumn] = useState<string | null>(null);
  
  const toast = useToast();
  const router = useRouter();
  const [editingProject, setEditingProject] = useState(false);
  // "Add task" dialog
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTask, setNewTask] = useState<TaskDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [newTitleError, setNewTitleError] = useState('');
  const newTitleRef = useRef<HTMLInputElement>(null);
  // Loading the board: null = fine, otherwise what went wrong.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectMissing, setProjectMissing] = useState(false);
  
  // The auth cookie is httpOnly, so the page can't (and shouldn't) read it; the browser sends it
  // with the WebSocket handshake on its own.
  const { isConnected, lastMessage, connectionEpoch } = useWebsocket();

  // Task detail dialog. Keep only the id and look the task up in the live board data, so the dialog
  // always shows the latest version and closes by itself if the task is deleted by someone else.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const selectedTask = selectedTaskId
    ? Object.values(tasks).flat().find((t) => t.id === selectedTaskId) ?? null
    : null;

  useEffect(() => {
    api.get('/auth/me').then((data) => setMe(data.user)).catch(() => setMe(null));
  }, []);

  // Filters. The text search is debounced; the selects apply at once.
  const [filters, setFilters] = useState<BoardFilterValues>(EMPTY_BOARD_FILTERS);
  const [debouncedQ, setDebouncedQ] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filters.q.trim()), 300);
    return () => clearTimeout(timer);
  }, [filters.q]);
  // Everyone who can see this project (all of the workspace, or a private project's people): the
  // choices for assignee, @mentions and the assignee filter.
  const fetchPeople = useCallback(
    () => api.get(`/projects/${params.id}/members`).then(setMembers).catch(() => setMembers([])),
    [params.id]
  );
  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);
  const [peopleOpen, setPeopleOpen] = useState(false);

  // The organization's labels, for the filter and the task dialog's picker.
  const [orgLabels, setOrgLabels] = useState<Label[]>([]);
  const fetchLabels = useCallback(
    () => listLabels().then(setOrgLabels).catch(() => setOrgLabels([])),
    []
  );
  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);
  // If the label being filtered on is deleted, drop that filter (adjusting state during render).
  if (filters.label && !orgLabels.some((l) => l.id === filters.label)) {
    setFilters({ ...filters, label: '' });
  }

  // Close the dialog if its task disappeared (adjusting state during render, not in an effect).
  if (selectedTaskId && !selectedTask) setSelectedTaskId(null);

  const fetchTasks = useCallback(
    () =>
      api
        .get(
          `/projects/${params.id}/tasks${buildQuery({
            q: debouncedQ,
            priority: filters.priority ? [filters.priority] : undefined,
            assignee: filters.assignee,
            label: filters.label ? [filters.label] : undefined,
          })}`
        )
        .then((data) => {
          // Each column is its first page (see the API's BOARD_COLUMN_LIMIT).
          setTasks({
            todo: data.todo || [],
            in_progress: data.in_progress || [],
            in_review: data.in_review || [],
            done: data.done || []
          });
          setTotals(data.totals ?? {});
          setCursors(data.cursors ?? {});
          setLoadError(null);
        })
        .catch((e) => setLoadError(messageOf(e, 'Could not load the tasks'))),
    [params.id, debouncedQ, filters.priority, filters.assignee, filters.label]
  );

  // "Show more" in one column: the next page of that column from task search, with the same filters.
  const loadMore = async (column: string) => {
    const cursor = cursors[column];
    if (!cursor) return;
    setLoadingColumn(column);
    try {
      const page = await api.get(
        `/tasks${buildQuery({
          project_id: params.id,
          status: [column],
          q: debouncedQ,
          priority: filters.priority ? [filters.priority] : undefined,
          assignee: filters.assignee,
          label: filters.label ? [filters.label] : undefined,
          sort: 'created_at',
          order: 'asc',
          limit: 100,
          cursor,
        })}`
      );
      setTasks((prev) => ({
        ...prev,
        [column]: [...(prev[column] ?? []), ...page.items.filter((t: any) => !(prev[column] ?? []).some((x) => x.id === t.id))],
      }));
      setCursors((prev) => ({ ...prev, [column]: page.next_cursor }));
    } catch (e) {
      toast(messageOf(e, 'Could not load more tasks'), 'error');
    } finally {
      setLoadingColumn(null);
    }
  };

  const fetchProject = useCallback(
    () =>
      api
        .get(`/projects/${params.id}`)
        .then((data) => {
          setProject(data);
          setProjectMissing(false);
        })
        .catch((e) => {
          // A 404 (deleted, or another organization's id) is "not found"; anything else is a load error.
          if (/not found/i.test(messageOf(e, ''))) setProjectMissing(true);
          else setLoadError(messageOf(e, 'Could not load the project'));
        }),
    [params.id]
  );

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  // Also re-runs when the filters change (fetchTasks depends on them).
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Handle real-time WebSocket updates
  useEffect(() => {
    if (!lastMessage) return;

    // A label was created, renamed, recolored or deleted somewhere in the organization.
    if (lastMessage.type === 'labels_changed') {
      fetchLabels();
      fetchTasks();
      return;
    }

    if (lastMessage.project_id === params.id) {
      // Someone changed who can see this project: maybe us (the reload then says it is gone).
      if (lastMessage.type === 'project_access_changed') {
        fetchProject();
        fetchPeople();
        fetchTasks();
        return;
      }
      if (
        lastMessage.type === 'task_created' ||
        lastMessage.type === 'task_updated' ||
        lastMessage.type === 'task_deleted'
      ) {
        // Re-fetch to guarantee consistency on collaborative edits
        fetchTasks();
      }
    }
  }, [lastMessage, params.id, fetchTasks, fetchLabels, fetchProject, fetchPeople]);

  // Events published while the socket was down are not replayed, so catch up after a reconnect.
  // (Epoch 1 is the first connect, when the initial fetch above already ran.)
  useEffect(() => {
    if (connectionEpoch > 1) fetchTasks();
  }, [connectionEpoch, fetchTasks]);

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
    if (source.droppableId !== destination.droppableId) {
      setTotals((prev) => ({
        ...prev,
        [source.droppableId]: Math.max(0, (prev[source.droppableId] ?? 1) - 1),
        [destination.droppableId]: (prev[destination.droppableId] ?? 0) + 1,
      }));
    }

    // Persist change
    try {
      await api.patch(`/projects/${params.id}/tasks/${draggableId}`, {
        status: destination.droppableId
      });
    } catch (err) {
      toast(messageOf(err, 'Could not move the task'), 'error');
      // Put the board back the way the server has it.
      fetchTasks();
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) {
      setNewTitleError('A task needs a title.');
      newTitleRef.current?.focus();
      return;
    }
    setNewTitleError('');
    setCreating(true);
    try {
      await api.post(`/projects/${params.id}/tasks`, newTaskBody(newTask));
      setNewTask(EMPTY_DRAFT);
      setIsModalOpen(false);
      toast('Task created');
      fetchTasks();
    } catch (err) {
      toast(messageOf(err, 'Could not create the task'), 'error');
    } finally {
      setCreating(false);
    }
  };

  // Viewers can look but not change anything (the API enforces this too).
  const canEdit = me !== null && me.role !== 'viewer';

  if (projectMissing) {
    return (
      <div className="p-8 max-w-xl">
        <h1 className="text-2xl font-bold">Project not found</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">It may have been deleted, or the link is wrong.</p>
        <Link href="/projects" className="btn-compact mt-4">Back to projects</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-100 dark:bg-slate-950/50">
      <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap gap-4 justify-between items-center shrink-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold break-words">
              {project?.name ?? <span className="inline-block h-7 w-48 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" aria-label="Loading project" />}
            </h1>
            {project?.visibility === 'private' && (
              <span className="flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40 px-2 py-1 rounded-full">
                <Lock className="w-3 h-3" aria-hidden="true" /> Private
              </span>
            )}
            {isConnected ? (
              <span className="flex items-center text-xs font-medium text-green-800 bg-green-100 dark:text-green-300 dark:bg-green-900/40 px-2 py-1 rounded-full"><span className="w-2 h-2 rounded-full bg-green-500 mr-1 animate-pulse" aria-hidden="true"></span> Live</span>
            ) : (
              <span className="flex items-center text-xs font-medium text-slate-700 bg-slate-100 dark:text-slate-300 dark:bg-slate-800 px-2 py-1 rounded-full"><AlertCircle className="w-3 h-3 mr-1" aria-hidden="true" /> Disconnected</span>
            )}
          </div>
          {project?.description && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{project.description}</p>}
        </div>
        {(canEdit || project?.visibility === 'private') && (
          <div className="flex flex-wrap gap-2">
            {project?.visibility === 'private' && me && (
              <button onClick={() => setPeopleOpen(true)} className="btn-secondary">
                <Users className="w-4 h-4" aria-hidden="true" />
                People
              </button>
            )}
            {canEdit && project && (
              <button onClick={() => setEditingProject(true)} className="btn-secondary">
                <Pencil className="w-4 h-4" aria-hidden="true" />
                Edit project
              </button>
            )}
            {canEdit && (
              <button onClick={() => setIsModalOpen(true)} className="btn-compact">
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add task
              </button>
            )}
          </div>
        )}
      </div>

      <BoardFilters value={filters} onChange={setFilters} members={members} labels={orgLabels} />
      {isFiltering(filters) && (
        <p className="px-4 sm:px-8 pt-2 text-xs text-slate-600 dark:text-slate-400">Showing matching tasks only.</p>
      )}

      {loadError && (
        <div className="px-4 sm:px-8 pt-4">
          <ErrorBlock message={loadError} onRetry={() => { setLoadError(null); fetchProject(); fetchTasks(); }} />
        </div>
      )}

      {/* Focusable so keyboard users can scroll the columns sideways even when no card is focusable
          (an empty board), as WCAG asks of scrollable regions. */}
      <div className="flex-1 overflow-x-auto p-4 sm:p-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500" tabIndex={0} role="region" aria-label="Board columns">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-6 h-full items-start">
            {COLUMNS.map(col => (
              <section key={col.id} aria-label={col.title} className="w-72 sm:w-80 shrink-0 flex flex-col max-h-full">
                <div className={`px-4 py-3 rounded-t-xl font-semibold text-sm ${col.color}`}>
                  {col.title} <span className="ml-2 opacity-60 text-xs font-normal">{totals[col.id] ?? tasks[col.id]?.length ?? 0}</span>
                </div>
                
                <Droppable droppableId={col.id}>
                  {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                    <div 
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto p-3 rounded-b-xl border-x border-b border-slate-200 dark:border-slate-800 transition-colors ${snapshot.isDraggingOver ? 'bg-slate-200/50 dark:bg-slate-800/50' : 'bg-slate-50 dark:bg-slate-900/50'}`}
                      style={{ minHeight: '150px' }}
                    >
                      {tasks[col.id]?.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={!canEdit}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              // A click anywhere on the card opens it; keyboard and screen-reader users
                              // use the title button. The card is not itself a button, because it
                              // contains another control (the drag handle).
                              onClick={() => setSelectedTaskId(task.id)}
                              className={`bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 mb-3 group cursor-pointer focus-within:ring-2 focus-within:ring-indigo-500 ${snapshot.isDragging ? 'shadow-xl scale-105 ring-2 ring-indigo-500' : 'hover:border-indigo-300 dark:hover:border-indigo-500'} transition-all`}
                            >
                              <div className="flex items-start gap-2">
                                <div {...provided.dragHandleProps} onClick={(e) => e.stopPropagation()} aria-label={`Move task: ${task.title}`} className={`text-slate-400 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity mt-1 cursor-grab active:cursor-grabbing ${canEdit ? '' : 'hidden'}`}>
                                  <GripVertical className="w-4 h-4" aria-hidden="true" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-medium text-slate-900 dark:text-slate-100">
                                    <button
                                      type="button"
                                      aria-label={`Open task: ${task.title}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedTaskId(task.id);
                                      }}
                                      className="text-left break-words outline-none"
                                    >
                                      {task.title}
                                    </button>
                                  </h3>
                                  {task.labels?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {task.labels.map((l: Label) => (
                                        <LabelChip key={l.id} label={l} />
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between mt-3">
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                      task.priority === 'high' || task.priority === 'urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                      'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                    }`}>
                                      {priorityLabel(task.priority)}
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
                      {cursors[col.id] && (
                        <button
                          type="button"
                          onClick={() => loadMore(col.id)}
                          disabled={loadingColumn === col.id}
                          className="w-full mt-1 py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-white/60 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50"
                        >
                          {loadingColumn === col.id
                            ? 'Loading...'
                            : `Show more (${Math.max(0, (totals[col.id] ?? 0) - (tasks[col.id]?.length ?? 0))} more)`}
                        </button>
                      )}
                    </div>
                  )}
                </Droppable>
              </section>
            ))}
          </div>
        </DragDropContext>
      </div>

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          projectId={params.id}
          me={me}
          lastMessage={lastMessage}
          orgLabels={orgLabels}
          members={members}
          onClose={() => setSelectedTaskId(null)}
          onChanged={fetchTasks}
        />
      )}

      {editingProject && project && (
        <ProjectDialog
          project={project}
          canDelete={me?.role === 'admin' || me?.role === 'owner'}
          canChangeVisibility={me?.role === 'admin' || me?.role === 'owner' || project.created_by === me?.user_id}
          onClose={() => setEditingProject(false)}
          onSaved={(saved) => {
            setProject(saved);
            setEditingProject(false);
            fetchPeople();
            fetchTasks();
          }}
          onDeleted={() => router.push('/projects')}
        />
      )}

      {peopleOpen && project && me && (
        <ProjectPeopleDialog
          projectId={params.id}
          projectName={project.name}
          me={me}
          onClose={() => setPeopleOpen(false)}
          onChanged={() => {
            fetchPeople();
            fetchTasks();
          }}
        />
      )}

      {isModalOpen && (
        <Dialog
          title="Add task"
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleCreateTask}
          initialFocus={newTitleRef}
          footer={
            <>
              <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn-compact" disabled={creating}>
                {creating ? 'Creating…' : 'Create task'}
              </button>
            </>
          }
        >
          <TaskForm draft={newTask} onChange={setNewTask} members={members} titleRef={newTitleRef} titleError={newTitleError} disabled={creating} />
        </Dialog>
      )}
    </div>
  );
}
