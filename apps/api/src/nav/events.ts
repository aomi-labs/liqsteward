import { EventEmitter } from "node:events";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { NavStore } from "./store.js";

export type NavEventName = "node.written" | "node.priced" | "dag.compiled" | "break.opened" | "break.updated";

interface NavEvent {
  seq: number;
  dag_id: string;
  name: NavEventName;
  data: Record<string, unknown>;
}

/**
 * Persisted event log plus an in-process fan-out. Persistence gives
 * `Last-Event-ID` resume across reconnects and function restarts; the
 * emitter gives sub-second delivery while the process lives.
 */
export class NavEvents {
  private readonly emitter = new EventEmitter();

  constructor(private readonly store: NavStore) {
    this.emitter.setMaxListeners(200);
  }

  async emit(dagId: string, name: NavEventName, data: Record<string, unknown>) {
    const seq = await this.store.appendEvent(dagId, name, data);
    this.emitter.emit(dagId, { seq, dag_id: dagId, name, data } satisfies NavEvent);
  }

  async stream(request: FastifyRequest, reply: FastifyReply, dagId: string) {
    const lastId = Number(request.headers["last-event-id"] ?? 0);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const write = (event: NavEvent) => {
      reply.raw.write(`id: ${event.seq}\nevent: ${event.name}\ndata: ${JSON.stringify({ dag_id: event.dag_id, ...event.data })}\n\n`);
    };
    let delivered = Number.isFinite(lastId) ? lastId : 0;
    const backlog = await this.store.eventsAfter(dagId, delivered);
    for (const row of backlog) {
      write({ seq: row.seq, dag_id: row.dagId, name: row.name as NavEventName, data: row.data as Record<string, unknown> });
      delivered = row.seq;
    }
    const listener = (event: NavEvent) => {
      if (event.seq > delivered) {
        delivered = event.seq;
        write(event);
      }
    };
    this.emitter.on(dagId, listener);
    const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
    const close = () => {
      clearInterval(keepAlive);
      this.emitter.off(dagId, listener);
      reply.raw.end();
    };
    request.raw.on("close", close);
    reply.raw.write(": connected\n\n");
    await new Promise<void>((resolve) => request.raw.on("close", () => resolve()));
  }
}
