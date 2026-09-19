/**
 * Substitui o pacote `server-only` nos testes.
 *
 * Ele existe apenas para o bundler do Next recusar esses modulos no cliente;
 * fora do bundler, importa-lo lanca. Como os testes rodam em Node puro, o
 * modulo precisa ser vazio.
 */
export {};
