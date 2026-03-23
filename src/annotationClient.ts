import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface Annotation {
    id: string;
    file: string;
    line: number;
    end_line: number;
    selected_text: string;
    text: string;
    username: string;
    created_at: string;
}

export interface NewAnnotation {
    file: string;
    line: number;
    end_line: number;
    selected_text: string;
    text: string;
    username: string;
}

export class AnnotationClient {
    constructor(private context: vscode.ExtensionContext) {}

    private get baseUrl(): string {
        return vscode.workspace.getConfiguration('annotationsPlugin').get('serverUrl') || 'http://localhost:5000';
    }

    private request<T>(method: string, path: string, body?: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const payload = body ? JSON.stringify(body) : undefined;
            const isHttps = url.protocol === 'https:';
            const lib = isHttps ? https : http;

            const options: http.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            };

            const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data) as T);
                        } catch {
                            resolve(data as unknown as T);
                        }
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            if (payload) {
                req.write(payload);
            }
            req.end();
        });
    }

    async getAnnotations(filePath: string): Promise<Annotation[]> {
        const encoded = encodeURIComponent(filePath);
        return this.request<Annotation[]>('GET', `/annotations?file=${encoded}`);
    }

    async addAnnotation(annotation: NewAnnotation): Promise<Annotation> {
        return this.request<Annotation>('POST', '/annotations', annotation);
    }

    async updateAnnotation(id: string, text: string): Promise<Annotation> {
        return this.request<Annotation>('PUT', `/annotations/${id}`, { text });
    }

    async deleteAnnotation(id: string): Promise<void> {
        return this.request<void>('DELETE', `/annotations/${id}`);
    }

    async getAllAnnotations(): Promise<Annotation[]> {
        return this.request<Annotation[]>('GET', '/annotations');
    }
}
