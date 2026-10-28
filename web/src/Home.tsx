import { Problems } from "./catalog/Problems";
import { Queue } from "./queue/Queue";
import { useSchedule } from "./queue/useSchedule";

// One /api/schedule request feeds both the queue and the catalog's Status / Next review columns.
export function Home() {
  const schedule = useSchedule();
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
      <Queue data={schedule} />
      <Problems schedules={typeof schedule === "object" ? schedule.schedules : []} />
    </main>
  );
}
