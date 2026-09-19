import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadSettings, loadTraining } from "@/lib/queries";
import { TrainingClient } from "./training-client";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [settings, program] = await Promise.all([
    loadSettings(session.id),
    loadTraining(session.id),
  ]);

  if (!settings) redirect("/sair");

  return (
    <TrainingClient
      placementWpm={settings.placementWpm}
      baseWpm={settings.baseWpm}
      program={program}
    />
  );
}
