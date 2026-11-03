export interface CatalogSubject { id: number; name: string; topicCount: number }
export interface CatalogTopic { id: number; subjectId: number; name: string; level: string }
