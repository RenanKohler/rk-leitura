/**
 * Consulta falsa do Drizzle para testes sem banco: qualquer metodo encadeado
 * (`from`, `where`, `orderBy`...) devolve a propria consulta, e o `await`
 * resolve com o valor dado.
 */
export function fakeQuery<T>(result: T): unknown {
  const query: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return () => query;
      },
    }
  );
  return query;
}
