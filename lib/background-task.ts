export type TaskStatus = "running" | "success" | "error";

export type BackgroundTask<T = unknown> = {
  promise: Promise<T>;
  result?: T;
  error?: unknown;
  progress?: string;
  status: TaskStatus;
};

type TaskListener = () => void;

const tasks = new Map<string, BackgroundTask<unknown>>();
const listeners = new Set<TaskListener>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function startTask<T>(key: string, fn: () => Promise<T>): BackgroundTask<T> {
  const current = tasks.get(key) as BackgroundTask<T> | undefined;
  if (current?.status === "running") return current;

  const task = {
    status: "running" as const,
  } as BackgroundTask<T>;

  task.promise = Promise.resolve().then(fn);
  tasks.set(key, task as BackgroundTask<unknown>);
  notifyListeners();

  task.promise.then(
    (result) => {
      if (tasks.get(key) !== task) return;
      task.result = result;
      task.status = "success";
      notifyListeners();
    },
    (error: unknown) => {
      if (tasks.get(key) !== task) return;
      task.error = error;
      task.status = "error";
      notifyListeners();
    },
  );

  return task;
}

export function getTask<T>(key: string): BackgroundTask<T> | undefined {
  return tasks.get(key) as BackgroundTask<T> | undefined;
}

export function updateTaskProgress(key: string, progress: string) {
  const task = tasks.get(key);
  if (!task || task.status !== "running") return;
  task.progress = progress;
  notifyListeners();
}

export function clearTask(key: string) {
  if (!tasks.delete(key)) return;
  notifyListeners();
}

export function getTasks(): ReadonlyArray<readonly [string, BackgroundTask<unknown>]> {
  return Array.from(tasks.entries());
}

export function subscribeTasks(listener: TaskListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
