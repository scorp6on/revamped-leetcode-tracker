import { Problems } from "./catalog/Problems";

// The queue (Today / Upcoming / Overdue) joins above the catalog in M4.
export function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
      <Problems />
    </main>
  );
}
