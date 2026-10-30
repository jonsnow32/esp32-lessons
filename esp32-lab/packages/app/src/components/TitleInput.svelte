<script lang="ts">
  // A project's name being edited in place: Enter or leaving the box keeps it, Esc puts it back.
  // window.prompt() would be simpler, but Electron doesn't implement it.
  let { value, onsave, ondone }: {
    value: string;
    /** The new name, trimmed and not empty. */
    onsave: (title: string) => void;
    /** Editing is over, kept or not. */
    ondone: () => void;
  } = $props();

  let text = $state(value);
  let finished = false;

  function finish(keep: boolean) {
    if (finished) return;
    finished = true;
    if (keep && text.trim() && text.trim() !== value) onsave(text.trim());
    ondone();
  }

  /** Focused with the name selected, ready to type over. */
  function grab(el: HTMLInputElement) {
    el.focus();
    // bind:value fills the box after the action runs
    requestAnimationFrame(() => el.select());
  }
</script>

<input
  use:grab
  bind:value={text}
  aria-label="Tên dự án"
  maxlength="80"
  onclick={(e) => e.stopPropagation()}
  onkeydown={(e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  }}
  onblur={() => finish(true)}
/>

<style>
  input { font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--accent); border-radius: 0; padding: 2px 6px; width: 100%; min-width: 120px; outline: none; }
</style>
