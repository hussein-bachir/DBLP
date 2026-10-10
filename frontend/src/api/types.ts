import type { components } from './schema';

// Generated from the FastAPI models (npm run gen:api); re-exported under short names.
type Schemas = components['schemas'];

export type Status = Schemas['Status'];
export type SearchResponse = Schemas['SearchResponse'];
export type SearchResult = Schemas['SearchResult'];
export type Profile = Schemas['Profile'];
export type Paper = Schemas['Paper'];
export type PapersPage = Schemas['PapersPage'];
export type CoAuthor = Schemas['CoAuthor'];
export type VenueCount = Schemas['VenueCount'];

export type AskStatus = Schemas['AskStatus'];
export type AskRequest = Schemas['AskRequest'];
export type LLMProvider = Schemas['LLMProvider'];
export type AskEvent = Schemas['AskEvent'];
export type AskDoneEvent = Schemas['AskDoneEvent'];
export type SourcePaper = Schemas['SourcePaper'];
export type AuthorRef = Schemas['AuthorRef'];
export type AskDiagnostics = Schemas['AskDiagnostics'];
