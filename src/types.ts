export type AnnotationStatus = "open" | "resolved";

export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
  refinedBy?: FragmentSelector;
}

export interface FragmentSelector {
  type: "FragmentSelector";
  value: string;
}

export interface W3CAnnotation {
  "@context": string;
  id: string;
  type: "Annotation";
  motivation: string;
  status: AnnotationStatus;
  creator: {
    id: string;
    type: "Person";
    name: string;
  };
  created: string;
  modified: string;
  body: {
    type: "TextualBody";
    value: string;
    format: string;
  };
  target: {
    source: string;
    selector: TextQuoteSelector;
  };
  replyTo?: string;
  replyCount: number;
}

export interface AnnotationListResponse {
  total: number;
  page: number;
  per_page: number;
  annotations: W3CAnnotation[];
}

export interface CreateAnnotationRequest {
  motivation: string;
  body: {
    type: "TextualBody";
    value: string;
    format: string;
  };
  target: {
    source: string;
    selector: TextQuoteSelector;
  };
  replyTo?: string;
}
