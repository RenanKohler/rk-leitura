import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { comprehensionQuizzes } from "@/db/schema";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { loadText } from "@/lib/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { contentKey, MIN_WORDS_FOR_QUIZ, parseQuiz, type Quiz } from "@/lib/quiz";
import { generateQuiz, QuizUnavailable } from "@/lib/quiz-generator";

export const dynamic = "force-dynamic";
// A geracao chama um modelo: pode passar dos 10s padrao das funcoes.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * Devolve o questionario do texto, gerando uma unica vez por versao do
 * conteudo.
 *
 * O cache e por (texto, impressao do conteudo): reabrir a tela de conclusao
 * nao gera de novo, e anexar uma parte pela continuacao gera um questionario
 * novo em vez de manter o da primeira parte.
 *
 * As respostas corretas nao saem daqui - so as alternativas. Mandar o gabarito
 * junto transformaria o questionario em decoracao.
 */
export async function POST(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // Geracao custa dinheiro por uso: o limite e contra laco acidental, nao
  // contra o usuario.
  const limit = rateLimit(`quiz:${clientIp(_request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitos questionarios seguidos. Aguarde um pouco.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Texto nao encontrado.", 404);

    const text = await loadText(session.id, id);
    if (!text) return jsonError("Texto nao encontrado.", 404);

    if (text.wordCount < MIN_WORDS_FOR_QUIZ) {
      return jsonError(
        `O questionario precisa de pelo menos ${MIN_WORDS_FOR_QUIZ} palavras.`,
        422
      );
    }

    const key = contentKey(text.content);
    const quiz = (await cached(id, key)) ?? (await generateAndStore(id, key, text.title, text.content));

    return NextResponse.json({ quiz: withoutAnswers(quiz), questions: quiz.questions.length });
  } catch (error) {
    if (error instanceof QuizUnavailable) return jsonError(error.message, 503);
    return serverError("texts/questionario", error);
  }
}

async function cached(textId: string, key: string): Promise<Quiz | null> {
  const [row] = await db
    .select({ questions: comprehensionQuizzes.questions })
    .from(comprehensionQuizzes)
    .where(
      and(eq(comprehensionQuizzes.textId, textId), eq(comprehensionQuizzes.contentKey, key))
    )
    .limit(1);

  return row ? parseQuiz(row.questions) : null;
}

async function generateAndStore(
  textId: string,
  key: string,
  title: string,
  content: string
): Promise<Quiz> {
  const quiz = await generateQuiz(title, content);

  await db
    .insert(comprehensionQuizzes)
    .values({ textId, contentKey: key, questions: JSON.stringify(quiz) })
    // Duas abas pedindo ao mesmo tempo: a segunda aproveita a primeira.
    .onConflictDoNothing();

  return quiz;
}

/** O gabarito fica no servidor; a tela recebe so o que precisa mostrar. */
function withoutAnswers(quiz: Quiz) {
  return {
    questions: quiz.questions.map((question) => ({
      prompt: question.prompt,
      choices: question.choices,
    })),
  };
}
