import type { Media, Snapshot } from '../domain/model';
import type { Text } from '../domain/messages';
import type { SelectionRequest } from '../application/plan';
import type AttachmentAtlas from '../main';
import type { OrganizerViewState } from './organizer-state';

export interface OrganizerResultContext {
  readonly plugin: AttachmentAtlas;
  readonly state: OrganizerViewState;
  readonly viewId: number;
  readonly queryValid: () => boolean;
  readonly onPreview: (selection: SelectionRequest) => void;
  readonly expandedGroups: Set<string>;
  readonly imageDetails: (parent: HTMLElement, image: Media) => void;
  readonly writeBlocker: (snapshot: Snapshot) => string;
  readonly reasons: (parent: HTMLElement, reasons: readonly Text[]) => void;
  readonly pagination: (
    parent: HTMLElement,
    total: number,
    size: number,
    page: number,
    setPage: (page: number) => void,
    focusKey: string,
  ) => void;
  readonly rerender: () => void;
}
