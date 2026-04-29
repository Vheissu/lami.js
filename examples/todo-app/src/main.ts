import { enhance, type AppHandle } from '@lami.js/runtime';

export interface TodoItem {
  id: number;
  title: string;
  done: boolean;
}

export type TodoFilter = 'all' | 'active' | 'completed';

export interface TodoExampleOptions {
  todos?: TodoItem[];
  filter?: TodoFilter;
}

export const todoTemplate = `
  <section class="todo-shell">
    <header class="masthead">
      <p class="eyebrow">Lami.js example</p>
      <h1>Today, plainly</h1>
      <p class="summary">\${remainingCount} open, \${completedCount} done</p>
    </header>

    <form class="entry" @submit:prevent="add($event)">
      <label>
        <span>New task</span>
        <input value.bind="newTitle" placeholder="Write the next thing">
      </label>
      <button disabled.bind="!canAdd">Add</button>
    </form>

    <nav class="filters" aria-label="Todo filters">
      <button type="button" active.class="filter === 'all'" @click="setFilter('all')">All</button>
      <button type="button" active.class="filter === 'active'" @click="setFilter('active')">Active</button>
      <button type="button" active.class="filter === 'completed'" @click="setFilter('completed')">Done</button>
    </nav>

    <p class="empty" if.bind="visibleTodos.length === 0">Nothing in this view.</p>
    <ul class="todo-list">
      <li repeat.for="todo of visibleTodos; key: id" done.class="todo.done">
        <label>
          <input type="checkbox" checked.bind="todo.done">
          <span>\${todo.title}</span>
        </label>
        <button type="button" aria-label="Remove task" @click="remove(todo)">Remove</button>
      </li>
    </ul>

    <footer class="footer">
      <button type="button" @click="clearCompleted()" disabled.bind="completedCount === 0">Clear done</button>
    </footer>
  </section>
`;

export class TodoExampleModel {
  newTitle = '';
  filter: TodoFilter;
  todos: TodoItem[];
  private nextId: number;

  constructor(options: TodoExampleOptions = {}) {
    this.todos = options.todos?.map(todo => ({ ...todo })) ?? [
      { id: 1, title: 'Read the template', done: true },
      { id: 2, title: 'Change a binding', done: false },
      { id: 3, title: 'Ship the small thing', done: false }
    ];
    this.filter = options.filter ?? 'all';
    this.nextId = Math.max(0, ...this.todos.map(todo => todo.id)) + 1;
  }

  get canAdd(): boolean {
    return this.newTitle.trim().length > 0;
  }

  get completedCount(): number {
    return this.todos.filter(todo => todo.done).length;
  }

  get remainingCount(): number {
    return this.todos.length - this.completedCount;
  }

  get visibleTodos(): TodoItem[] {
    if (this.filter === 'active') return this.todos.filter(todo => !todo.done);
    if (this.filter === 'completed') return this.todos.filter(todo => todo.done);
    return this.todos;
  }

  add(event?: Event): void {
    event?.preventDefault();
    const title = this.newTitle.trim();
    if (!title) return;

    this.todos.push({
      id: this.nextId++,
      title,
      done: false
    });
    this.newTitle = '';
  }

  setFilter(filter: TodoFilter): void {
    this.filter = filter;
  }

  remove(todo: TodoItem): void {
    this.todos = this.todos.filter(item => item.id !== todo.id);
  }

  clearCompleted(): void {
    this.todos = this.todos.filter(todo => !todo.done);
  }
}

export function createTodoExample(options: TodoExampleOptions = {}): TodoExampleModel {
  return new TodoExampleModel(options);
}

export function mountTodoExample(
  root: Element,
  options: TodoExampleOptions = {}
): AppHandle {
  root.innerHTML = todoTemplate;
  return enhance(root, createTodoExample(options));
}

const browserRoot = typeof document === 'undefined'
  ? null
  : document.querySelector('[data-lami-example="todo"]');

if (browserRoot) {
  mountTodoExample(browserRoot);
}
