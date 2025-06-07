import * as https from 'https';
import { URL } from 'url';

export interface OutlineKey {
  id: string;
  name: string;
  accessUrl: string;
}

class OutlineService {
  private apiUrl: string;
  private baseOptions: https.RequestOptions;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;

    const url = new URL(this.apiUrl);
    this.baseOptions = {
      hostname: url.hostname,
      port: url.port,
      rejectUnauthorized: false,
    };
  }

  private _request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: object,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        ...this.baseOptions,
        path: new URL(path, this.apiUrl).pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          if (method === 'DELETE' && res.statusCode === 204) {
            return resolve({} as T);
          }
          return reject(
            new Error(`Request failed with status code ${res.statusCode}`),
          );
        }

        if (method === 'DELETE' && res.statusCode === 204) {
          return resolve({} as T);
        }

        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          try {
            const parsedBody = responseBody ? JSON.parse(responseBody) : {};
            resolve(parsedBody as T);
          } catch (error) {
            reject(new Error(`Failed to parse JSON response.`));
          }
        });
      });

      req.on('error', (error) => {
        console.error(`Request error for ${method} ${path} ->`, error);
        reject(error);
      });

      if (body && method === 'POST') [req.write(JSON.stringify(body))];

      req.end();
    });
  }

  public async validate(): Promise<boolean> {
    try {
      await this._request('GET', 'server');
      return true;
    } catch (error) {
      console.error('Failed to validate API URL ->', error);
      return false;
    }
  }

  public async getKeys(): Promise<OutlineKey[] | null> {
    try {
      const data = await this._request<{ accessKeys: OutlineKey[] }>(
        'GET',
        'access-keys/',
      );

      return data.accessKeys;
    } catch (error) {
      console.error('Failed to get outline keys ->', error);
      return null;
    }
  }

  public async createKey(name?: string): Promise<OutlineKey | null> {
    try {
      const body = name ? { name } : {};
      return await this._request<OutlineKey>('POST', 'access-keys/', body);
    } catch (error) {
      console.error('Failed to create key:', error);
      return null;
    }
  }

  public async deleteKey(keyId: string): Promise<boolean> {
    try {
      await this._request('DELETE', `access-keys/${keyId}`);
      return true;
    } catch (error) {
      console.error(`Failed to delete key ${keyId}:`, error);
      return false;
    }
  }
}

export default OutlineService;
