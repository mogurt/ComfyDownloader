import TaskInput from "@/components/TaskInput";
import TaskList from "@/components/TaskList";
import TaskDetail from "@/components/TaskDetail";
import LogPanel from "@/components/LogPanel";

export default function Home() {
  return (
    <div className="flex h-full flex-col">
      <TaskInput />
      <TaskList />
      <LogPanel />
      <TaskDetail />
    </div>
  );
}
