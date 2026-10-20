// Forme d'une traduction : mêmes clés que le français, valeurs en texte.
// Chaque fichier anglais est déclaré « satisfies Translation<typeof fr> » :
// une clé oubliée (ou en trop) fait échouer la compilation. Aucune
// fonctionnalité ne peut donc arriver dans une seule langue.
export type Translation<T> = { [K in keyof T]: T[K] extends string ? string : Translation<T[K]> };
