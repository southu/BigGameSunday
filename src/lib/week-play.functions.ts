import { createServerFn } from "@tanstack/react-start";
import type { PublicBoard } from "./week-play";

export type { PublicBoard } from "./week-play";

export const loadPublicBoard = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicBoard | null> => {
    try {
      const { loadQaBoard } = await import("./week-play.server");
      return await loadQaBoard();
    } catch (error) {
      console.error(error);
      return null;
    }
  },
);
