// Assemble des classes CSS en ignorant les valeurs vides (conditions fausses).
export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
