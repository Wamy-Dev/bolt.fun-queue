import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { env } from './env';

import { createQueue } from './queue';
import { createNotificationsWorker } from './workers/notifications_worker';

interface AddJobQueryString {
  id: string;
  email: string;
}

const run = async () => {
  const notificationsQueue = createQueue('Notifications Queue');
  await createNotificationsWorker(notificationsQueue.name);

  const server: FastifyInstance<Server, IncomingMessage, ServerResponse> =
    fastify();

  const serverAdapter = new FastifyAdapter();
  createBullBoard({
    queues: [new BullMQAdapter(notificationsQueue)],
    serverAdapter,
  });
  serverAdapter.setBasePath('/');
  server.register(serverAdapter.registerPlugin(), {
    prefix: '/',
    basePath: '/',
  });

  server.get(
    '/add-job',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            id: { type: 'string' },
          },
        },
      },
    },
    (req: FastifyRequest<{ Querystring: AddJobQueryString }>, reply) => {
      if (
        req.query == null ||
        req.query.email == null ||
        req.query.id == null
      ) {
        reply
          .status(400)
          .send({ error: 'Requests must contain both an id and a email' });

        return;
      }

      const { email, id } = req.query;
      notificationsQueue.add(`WelcomeEmail-${id}`, { email });

      reply.send({
        ok: true,
      });
    }
  );

  await server.listen({
    port: env.PORT,
    host: env.NODE_ENV === 'development' ? 'localhost' : '0.0.0.0',
  });
  console.log(
    `To populate the queue and demo the UI, run: curl ${env.RAILWAY_STATIC_URL}/add-job?id=1&email=hello%40world.com`
  );
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
