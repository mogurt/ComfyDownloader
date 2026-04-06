import { useState } from "react";
import TaskInput from "@/components/TaskInput";
import TaskList from "@/components/TaskList";
import TaskDetail from "@/components/TaskDetail";
import LogPanel from "@/components/LogPanel";
import BatchImport from "@/components/BatchImport";

export default function Home() {
  const [batchOpen, setBatchOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <TaskInput onBatchImport={() => setBatchOpen(true)} />
      <TaskList />
      <LogPanel />
      <TaskDetail />
      <BatchImport open={batchOpen} onClose={() => setBatchOpen(false)} />
    </div>
  );
}
