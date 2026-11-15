import type {
  AiSettings,
  AiSettingsInput,
  ChatMessage,
  ChatSendRequest,
  Conversation,
  Note,
  NoteType,
  Paper,
  SearchResult,
} from './types';

export interface PaperLensApi {
  papers: {
    list(): Promise<Paper[]>;
    get(id: number): Promise<Paper | null>;
    importOriginal(): Promise<Paper | null>;
    attachTranslated(id: number): Promise<Paper | null>;
    update(
      id: number,
      patch: Partial<
        Pick<Paper, 'title' | 'authors' | 'year' | 'tags' | 'lastPageOriginal' | 'lastPageTranslated'>
      >,
    ): Promise<Paper>;
    remove(id: number): Promise<void>;
    markRead(id: number, version: 'original' | 'translated', pageNo: number): Promise<void>;
    checkFiles(): Promise<{ id: number; originalExists: boolean; translatedExists: boolean }[]>;
    relocate(id: number, version: 'original' | 'translated'): Promise<Paper | null>;
  };
  pdf: {
    load(
      paperId: number,
      version: 'original' | 'translated',
    ): Promise<{ data: ArrayBuffer; fileName: string }>;
  };
  conversations: {
    list(paperId: number): Promise<Conversation[]>;
    create(paperId: number, title: string): Promise<Conversation>;
    rename(id: number, title: string): Promise<void>;
    remove(id: number): Promise<void>;
  };
  messages: {
    list(conversationId: number): Promise<ChatMessage[]>;
  };
  chat: {
    send(req: ChatSendRequest): Promise<{ requestId: string }>;
    abort(requestId: string): Promise<void>;
    onDelta(cb: (e: { requestId: string; delta: string }) => void): () => void;
    onDone(cb: (e: { requestId: string; message: ChatMessage }) => void): () => void;
    onError(cb: (e: { requestId: string; error: string }) => void): () => void;
  };
  notes: {
    list(paperId?: number): Promise<Note[]>;
    create(input: {
      paperId: number;
      type: NoteType;
      title: string;
      contentMd: string;
      tags: string[];
    }): Promise<Note>;
    update(id: number, patch: { title?: string; contentMd?: string; tags?: string[] }): Promise<Note>;
    remove(id: number): Promise<void>;
    generate(
      kind: 'summary' | 'concept' | 'innovation',
      params: {
        paperId: number;
        selectionText?: string;
        conceptTitle?: string;
        currentPageNo?: number;
      },
    ): Promise<Note | null>;
  };
  search: {
    global(query: string): Promise<SearchResult[]>;
  };
  exportFile: {
    save(suggestedName: string, content: string): Promise<string | null>;
  };
  window: {
    setFullscreen(fullscreen: boolean): Promise<boolean>;
    onFullscreenChange(cb: (fullscreen: boolean) => void): () => void;
  };
  settings: {
    get(): Promise<AiSettings>;
    set(input: AiSettingsInput): Promise<AiSettings>;
    test(input: AiSettingsInput): Promise<{ ok: boolean; error?: string }>;
  };
}
