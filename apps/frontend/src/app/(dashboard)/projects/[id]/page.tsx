'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useWebsocket } from '@/hooks/useWebsocket';
import { DragDropContext, Droppable, Draggable, DroppableProvided, DroppableStateSnapshot } from '@hello-pangea/dnd';
import { Plus, GripVertical, AlertCircle, Pencil, Lock, Users, CalendarDays, ChevronRight, Loader2, Inbox } from 'lucide-react';
import type { CurrentUser } from '@/components/TaskDetailModal';
import type { ProjectFields } from '@/components/ProjectDialog';
import Avatar from '@/components/ui/Avatar';
import { PriorityChip } from '@/components/TaskBadges';
import { isOverdue } from '@/components/dashboard/TaskRows';
import BoardFilters, { EMPTY_BOARD_FILTERS, isFiltering, type BoardFilterValues } from '@/components/BoardFilters';
import { buildQuery } from '@/lib/query';
import type { Member } from '@/lib/members';
import { listLabels, type Label } from '@/lib/labels';
import LabelChip from '@/components/LabelChip';
import TaskForm from '@/components/TaskForm';
import Dialog from '@/components/ui/Dialog';
import { messageOf, useToast } from '@/components/ui/feedback';
import { ErrorBlock } from '@/components/ui/states';
import ThreeScene from '@/components/three/ThreeScene';
import DisplayTitle from '@/components/ui/DisplayTitle';
import { EMPTY_DRAFT, STATUSES, newTaskBody, priorityLabel, statusLabel, type TaskDraft } from '@/lib/tasks';

// The dialogs are loaded when first opened, not with the board.
const TaskDetailModal = dynamic(() => import('@/components/TaskDetailModal'), { ssr: false });
const ProjectDialog = dynamic(() => import('@/components/ProjectDialog'), { ssr: false });
const ProjectPeopleDialog = dynamic(() => import('@/components/ProjectPeopleDialog'), { ssr: false });

/** Accent per column: the dot and top edge (decorative; the column title says the status). */
const COLUMN_ACCENTS: Record<(typeof STATUSES)[number]['value'], { dot: string; bar: string; over: string }> = {
  todo: { dot: 'bg-slate-400', bar: 'from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-500', over: 'bg-slate-200/60 dark:bg-slate-800/60 ring-slate-300 dark:ring-slate-600' },
  in_progress: { dot: 'bg-blue-500', bar: 'from-sky-400 to-blue-600', over: 'bg-blue-50/80 dark:bg-blue-500/10 ring-blue-300 dark:ring-blue-500/40' },
  in_review: { dot: 'bg-amber-500', bar: 'from-amber-400 to-orange-500', over: 'bg-amber-50/80 dark:bg-amber-500/10 ring-amber-300 dark:ring-amber-500/40' },
  done: { dot: 'bg-emerald-500', bar: 'from-emerald-400 to-teal-600', over: 'bg-emerald-50/80 dark:bg-emerald-500/10 ring-emerald-300 dark:ring-emerald-500/40' },
};

const COLUMNS = STATUSES.map((s) => ({ id: s.value, title: s.label, accent: COLUMN_ACCENTS[s.value] }));

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
      if (source.droppableId !== destination.droppableId) {
        toast(`Moved to ${statusLabel(destination.droppableId)}`, 'success', {
          label: 'Undo',
          run: () => {
            api
              .patch(`/projects/${params.id}/tasks/${draggableId}`, { status: source.droppableId })
              .then(() => toast(`Moved back to ${statusLabel(source.droppableId)}`, 'info'))
              .catch((e) => toast(messageOf(e, 'Could not undo the move'), 'error'))
              .finally(fetchTasks);
          },
        });
      }
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
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center animate-fade-up">
          <div aria-hidden="true" className="mx-auto mb-6 icon-tile w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/15 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-500/20 animate-float">
            <Inbox className="w-10 h-10" />
          </div>
          <h1 className="page-title">Project not found</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">It may have been deleted, or the link is wrong.</p>
          <Link href="/projects" className="btn-compact mt-6">Back to projects</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <div className="relative px-4 sm:px-10 pt-6 sm:pt-10 pb-6 flex flex-wrap gap-6 justify-between items-end shrink-0">
        <div className="min-w-0 flex items-start gap-4">
          <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-3 animate-fade-in">
            <ol className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400">
              <li>
                <Link href="/projects" className="link-draw hover:text-slate-900 dark:hover:text-white">All boards</Link>
              </li>
              <li aria-hidden="true"><ChevronRight className="w-3 h-3" /></li>
              <li aria-current="page" className="truncate max-w-[16rem]">{project?.name ?? '…'}</li>
            </ol>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            {project ? (
              <DisplayTitle text={project.name} className="text-[clamp(2.4rem,5vw,4.25rem)] leading-[0.95]" />
            ) : (
              <h1 className="page-title">
                <span className="skeleton inline-block h-12 w-72 align-middle" aria-label="Loading project" />
              </h1>
            )}
            {project?.visibility === 'private' && (
              <span className="chip py-1 text-amber-800 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40">
                <Lock className="w-3 h-3" aria-hidden="true" /> Private
              </span>
            )}
            {isConnected ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 dark:border-slate-700 px-3 py-1 font-mono text-xs text-slate-700 dark:text-slate-300">
                <span aria-hidden="true" className="relative flex w-2 h-2">
                  <span className="absolute inset-0 rounded-full bg-accent-500 opacity-75 animate-ping" />
                  <span className="relative w-2 h-2 rounded-full bg-accent-500" />
                </span>
                Live
              </span>
            ) : (
              <span className="chip py-1 text-slate-700 bg-slate-100 dark:text-slate-300 dark:bg-slate-800"><AlertCircle className="w-3 h-3" aria-hidden="true" /> Disconnected</span>
            )}
          </div>
          {project?.description && <p className="mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-400 animate-fade-up [animation-delay:200ms]">{project.description}</p>}
          </div>
        </div>
        {/* The board in 3D: one bar per column, as tall as its share of the tasks (live). */}
        <ThreeScene
          scene="columns"
          data={{ counts: COLUMNS.map((c) => totals[c.id] ?? tasks[c.id]?.length ?? 0) }}
          className="hidden xl:block ml-auto -my-8 h-40 w-80"
        />
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
        <p className="px-4 sm:px-8 pt-2 text-xs text-slate-600 dark:text-slate-400 animate-fade-in">Showing matching tasks only.</p>
      )}

      {loadError && (
        <div className="px-4 sm:px-8 pt-4">
          <ErrorBlock message={loadError} onRetry={() => { setLoadError(null); fetchProject(); fetchTasks(); }} />
        </div>
      )}

      {/* Focusable so keyboard users can scroll the columns sideways even when no card is focusable
          (an empty board), as WCAG asks of scrollable regions. */}
      <div className="flex-1 overflow-x-auto px-4 sm:px-10 pt-4 pb-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500" tabIndex={0} role="region" aria-label="Board columns">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-6 h-full items-start stagger">
            {COLUMNS.map((col, colIndex) => (
              <section
                key={col.id}
                aria-label={col.title}
                style={{ '--i': colIndex } as React.CSSProperties}
                className="group/col w-72 sm:w-80 shrink-0 flex flex-col max-h-full"
              >
                <div className="relative border-t border-slate-300 dark:border-slate-700 pt-3 pb-4">
                  <span aria-hidden="true" className={`absolute -top-px left-0 h-px w-10 transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/col:w-full ${col.accent.dot}`} />
                  <div className="flex items-baseline gap-3">
                    <span aria-hidden="true" className="font-mono text-xs text-slate-500">{String(colIndex + 1).padStart(2, '0')}</span>
                    <h2 className="font-display text-2xl font-medium tracking-[-0.03em] text-slate-900 dark:text-white">{col.title}</h2>
                    <span className="ml-auto font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                      {String(totals[col.id] ?? tasks[col.id]?.length ?? 0).padStart(2, '0')}
                      <span className="sr-only"> tasks</span>
                    </span>
                  </div>
                </div>
                
                <Droppable droppableId={col.id}>
                  {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                    <div 
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto p-2 rounded-2xl transition-all duration-300 ${snapshot.isDraggingOver ? `${col.accent.over} ring-2 ring-dashed` : 'bg-slate-100/70 dark:bg-slate-900/50'}`}
                      style={{ minHeight: '150px' }}
                    >
                      {tasks[col.id]?.length === 0 && !snapshot.isDraggingOver && (
                        <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-3 py-8 text-center font-mono text-xs text-slate-600 dark:text-slate-400">
                          {canEdit ? 'Drop tasks here' : 'No tasks'}
                        </p>
                      )}
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
                              style={provided.draggableProps.style}
                              className={`relative bg-white dark:bg-slate-800/80 p-4 rounded-xl border mb-2 group cursor-pointer focus-within:ring-4 focus-within:ring-accent-500/30 ${
                                snapshot.isDragging
                                  ? 'shadow-2xl border-slate-900 dark:border-slate-200'
                                  : 'border-slate-200 dark:border-slate-700 hover:shadow-lift hover:border-slate-900 dark:hover:border-slate-300'
                              } transition-[box-shadow,border-color] duration-300`}
                            >
                              <span aria-hidden="true" className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full bg-accent-500 scale-0 transition-transform duration-300 group-hover:scale-100" />
                              {/* The card tilts while it is carried (inner element: the library positions the outer one). */}
                              <div className={`transition-transform duration-200 ${snapshot.isDragging ? 'rotate-2 scale-[1.02]' : ''}`}>
                              <div className="flex items-start gap-2">
                                <div {...provided.dragHandleProps} onClick={(e) => e.stopPropagation()} aria-label={`Move task: ${task.title}`} className={`text-slate-400 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity mt-1 cursor-grab active:cursor-grabbing ${canEdit ? '' : 'hidden'}`}>
                                  <GripVertical className="w-4 h-4" aria-hidden="true" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="pr-3 text-[15px] font-medium leading-snug text-slate-900 dark:text-slate-100">
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
                                  <div className="flex items-center justify-between gap-2 mt-3">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <PriorityChip priority={task.priority} label={priorityLabel(task.priority)} />
                                      {task.due_date && (
                                        <span
                                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                                            isOverdue(task)
                                              ? 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200'
                                              : 'text-slate-600 dark:text-slate-400'
                                          }`}
                                        >
                                          <CalendarDays className="w-3 h-3" aria-hidden="true" />
                                          {isOverdue(task) && <span className="sr-only">Overdue, due</span>}
                                          {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                        </span>
                                      )}
                                    </div>
                                    {task.assignee_name && (
                                      <span title={task.assignee_name} className="shrink-0">
                                        <Avatar name={task.assignee_name} id={task.assignee_id ?? undefined} size="xs" className="ring-0 transition-transform group-hover:scale-110" />
                                        <span className="sr-only">Assigned to {task.assignee_name}</span>
                                      </span>
                                    )}
                                  </div>
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
                          className="w-full mt-1 py-2 flex items-center justify-center gap-1.5 font-mono text-xs text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 rounded-full transition-colors disabled:opacity-50"
                        >
                          {loadingColumn === col.id && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
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
          onSaved={(saved: ProjectFields) => {
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
                {creating && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
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
