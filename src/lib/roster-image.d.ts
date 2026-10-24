export interface RosterImageModel {
  title: string; date: string; time: string; location: string; capacity: number;
  playing: string[]; waitlist: string[]; snapshot: string;
}
export function rosterLayout(capacity: number, playing: string[], waitlist: string[]): {
  width: number; height: number; playing: { number: number; name: string | null }[];
  waitlist: { number: number; name: string | null }[]; playingRows: number; waitlistRows: number;
};
export function renderRosterImage(model: RosterImageModel): Promise<Blob>;
