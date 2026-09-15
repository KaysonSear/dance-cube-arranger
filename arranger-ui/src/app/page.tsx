import { Suspense } from "react";

import EditorShell from "@/components/EditorShell";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <EditorShell />
    </Suspense>
  );
}
