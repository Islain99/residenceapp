// Erreur HTTP prévue : renvoyée telle quelle au client par le gestionnaire
// d'erreurs (app.ts) sous la forme { error: code, message }.
export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export const notFound = (message = 'Introuvable.') => new HttpError(404, 'not_found', message);
export const forbidden = (message = 'Accès refusé.') => new HttpError(403, 'forbidden', message);
export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
