export interface RosterImageModel {
  title: string; date: string; time: string; location: string; capacity: number;
  playing: string[]; waitlist: string[]; snapshot: string;
}
export interface RosterImageCell { number: number; name: string | null; waiting: boolean }
export function rosterLayout(capacity: number, playing: string[], waitlist: string[]): {
  width: number; height: number; columns: number; rows: number; cells: RosterImageCell[];
  playing: RosterImageCell[]; waitlist: RosterImageCell[];
};
export function renderRosterImage(model: RosterImageModel): Promise<Blob>;
