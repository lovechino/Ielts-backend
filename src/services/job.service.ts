import { KVNamespace } from '@cloudflare/workers-types';

export type JobStatus = 'pending' | 'completed' | 'failed';

export interface JobData {
  id: string;
  status: JobStatus;
  progress?: number;
  result?: any;
  error?: string;
  updated_at: number;
}

export class JobService {
  private kv: KVNamespace;
  private PREFIX = 'job:';

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async create(jobId: string): Promise<JobData> {
    const job: JobData = {
      id: jobId,
      status: 'pending',
      updated_at: Date.now(),
    };
    await this.kv.put(this.PREFIX + jobId, JSON.stringify(job), { expirationTtl: 3600 }); // Expire in 1 hour
    return job;
  }

  async update(jobId: string, updates: Partial<Omit<JobData, 'id'>>): Promise<void> {
    const data = await this.get(jobId);
    if (!data) return;

    const updated = { ...data, ...updates, updated_at: Date.now() };
    await this.kv.put(this.PREFIX + jobId, JSON.stringify(updated), { expirationTtl: 3600 });
  }

  async get(jobId: string): Promise<JobData | null> {
    const val = await this.kv.get(this.PREFIX + jobId);
    return val ? JSON.parse(val) : null;
  }
}
