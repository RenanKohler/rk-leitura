import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { speedSettings, trainingPrograms } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { activeProgram, loadSettings, loadTraining } from "@/lib/queries";
import { todayIn } from "@/lib/goals";
import { asProgramLength, targetFor } from "@/lib/training";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ program: await loadTraining(session.id) });
  } catch (error) {
    return serverError("treino/get", error);
  }
}

/**
 * Comeca um programa.
 *
 * A velocidade de antes fica guardada na propria linha do programa: abandonar
 * precisa devolver o leitor onde ele estava, e enquanto o programa dura e ele
 * quem manda na preferencia de velocidade.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const body = await readJson<{ length?: unknown }>(request);
    const length = asProgramLength(body?.length);
    if (!length) return jsonError("Escolha um programa de 14 ou 30 dias.", 400);

    const settings = await loadSettings(session.id);
    if (!settings) return jsonError("Sessao expirada. Entre novamente.", 401);

    if (await activeProgram(session.id)) {
      return jsonError("Ja existe um programa em andamento.", 409);
    }

    // A partida e a velocidade medida no teste, quando houve; senao, a base.
    const startWpm = settings.placementWpm ?? settings.baseWpm;
    const first = targetFor(startWpm, length, []);

    await db.transaction(async (tx) => {
      await tx.insert(trainingPrograms).values({
        userId: session.id,
        length,
        startWpm,
        previousWpm: settings.baseWpm,
        startedOn: todayIn(settings.timezone),
      });

      await tx
        .update(speedSettings)
        .set({ baseWpm: first, updatedAt: new Date() })
        .where(eq(speedSettings.userId, session.id));
    });

    return NextResponse.json({ program: await loadTraining(session.id) }, { status: 201 });
  } catch (error) {
    return serverError("treino/post", error);
  }
}

/** Abandona o programa e devolve a velocidade de antes. */
export async function DELETE() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const program = await activeProgram(session.id);
    if (!program) return jsonError("Nao ha programa em andamento.", 404);

    await db.transaction(async (tx) => {
      await tx
        .update(trainingPrograms)
        .set({ endedAt: new Date() })
        .where(
          and(eq(trainingPrograms.id, program.id), isNull(trainingPrograms.endedAt))
        );

      await tx
        .update(speedSettings)
        .set({ baseWpm: program.previousWpm, updatedAt: new Date() })
        .where(eq(speedSettings.userId, session.id));
    });

    return NextResponse.json({ program: null, baseWpm: program.previousWpm });
  } catch (error) {
    return serverError("treino/delete", error);
  }
}
