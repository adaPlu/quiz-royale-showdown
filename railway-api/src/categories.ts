export const CATEGORIES = [
  "Arts",
  "Food",
  "Geography",
  "History",
  "Math",
  "Nature",
  "Pop Culture",
  "Science",
  "Sports",
  "Technology",
];

export const WORLD_BOARD = "WORLD";

export function normalizeBoard(raw: string | null | undefined): string {
  if (!raw || raw === WORLD_BOARD) return WORLD_BOARD;
  return CATEGORIES.find((category) => category.toLowerCase() === raw.toLowerCase()) ?? WORLD_BOARD;
}
