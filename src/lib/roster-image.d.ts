/** A roster entry: a plain display name, or a name with the user ID (for the initials colour) and a decoded photo. */
export type RosterImageEntry = string | { name: string; userId?: string | null; photo?: CanvasImageSource | null }
export interface RosterImageModel {
  title: string; date: string; time: string; location: string; capacity: number;
  playing: RosterImageEntry[]; waitlist: RosterImageEntry[]; snapshot: string;
}
export interface RosterImageCell {
  number: number; label: string; open: boolean; waiting: boolean;
  name: string | null; userId: string | null; photo: CanvasImageSource | null;
}
export function rosterLayout(capacity: number, playing: RosterImageEntry[], waitlist: RosterImageEntry[]): {
  width: number; height: number; columns: number; rows: number; playingRows: number; waitlistRows: number;
  playing: RosterImageCell[]; waitlist: RosterImageCell[]; showWaitlist: boolean;
};
export function renderRosterImage(model: RosterImageModel, makeCanvas?: () => HTMLCanvasElement): Promise<Blob>;
