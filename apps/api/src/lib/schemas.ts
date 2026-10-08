// Schémas TypeBox communs aux routes.
import { Type, type TSchema } from '@fastify/type-provider-typebox';

export const Uuid = Type.String({ format: 'uuid' });
export const IdParams = Type.Object({ id: Uuid });
export const DateOnly = Type.String({ format: 'date' });          // AAAA-MM-JJ
export const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()]);
export const Text = (max: number) => Type.String({ minLength: 1, maxLength: max });
export const Person = Type.Object({ id: Type.String(), firstName: Type.String(), lastName: Type.String() });

// Texte facultatif : espaces retirés, chaîne vide → null
export const optionalText = (value: string | null | undefined) => value?.trim() || null;
