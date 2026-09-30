"use client";

import { Button } from "@/components/ui";
import { GRADE_LABELS, gradeInterval, REVIEW_GRADES, type ReviewGrade } from "@/lib/vocabulary";

/** "1 d", "12 d", "3 m": o prazo cabe embaixo do rotulo sem quebrar a grade. */
function shortSpan(days: number): string {
  if (days < 60) return `${days} d`;
  return `${Math.round(days / 30)} m`;
}

/**
 * As quatro respostas da revisao (PROD-7), com o prazo que cada uma daria.
 *
 * Mostrar o prazo e o que torna a escolha honesta: "Facil" deixa de ser o
 * botao do meio e passa a ser "so volto a ver isso em um mes".
 */
export function GradeButtons({
  interval,
  busy,
  onGrade,
}: {
  interval: number;
  busy: boolean;
  onGrade: (grade: ReviewGrade) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Como foi lembrar">
      {REVIEW_GRADES.map((grade) => (
        <Button
          key={grade}
          variant={grade === "bom" ? "primary" : "secondary"}
          disabled={busy}
          onClick={() => onGrade(grade)}
          aria-label={`${GRADE_LABELS[grade]}, volta em ${gradeInterval(interval, grade)} ${
            gradeInterval(interval, grade) === 1 ? "dia" : "dias"
          }`}
          className="min-h-14 flex-col gap-0! rounded-2xl! px-1!"
        >
          <span>{GRADE_LABELS[grade]}</span>
          <span className="tabular text-xs font-normal opacity-75">
            {shortSpan(gradeInterval(interval, grade))}
          </span>
        </Button>
      ))}
    </div>
  );
}
