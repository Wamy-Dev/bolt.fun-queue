import { createWorker } from '../queue';
import 'websocket-polyfill';
import { relayInit, getPublicKey, getEventHash, signEvent } from 'nostr-tools';
import { Relay } from 'nostr-tools/relay';
import { env } from '../env';
import { Event } from 'nostr-tools/event';
import axios from 'axios';

const RELAYS = [
  'wss://nostr-pub.wellorder.net',
  'wss://nostr-relay.untethr.me',
  'wss://nostr.drss.io',
  'wss://relay.damus.io',
  'wss://nostr.swiss-enigma.ch',
];

export const createNostrWorker = (queueName = 'nostr') =>
  createWorker<NostrQueue['Job'], any, NostrQueue['JobNames']>(
    queueName,
    async (job) => {
      const logger = job.log.bind(job);

      if (job.data.type === 'create-story-root-event') {
        const connectedRelays = await connectToRelays(RELAYS, {
          logger,
        });
        if (connectedRelays.length === 0)
          throw new Error("Couldn't connect to any Nostr relay.");

        const storyRootEvent = createStoryRootEvent({ ...job.data.story });

        try {
          await publishEvent(storyRootEvent, connectedRelays, {
            logger,
          });

          logger('Event published on Nostr successfully');

          if (job.data.callback_url)
            await makeCallbackRequest(job.data.callback_url, {
              type: job.data.type,
              story_id: job.data.story.id,
              root_event_id: storyRootEvent.id,
            });
        } catch (error) {
          console.log(error);
          throw error;
        } finally {
          await closeRelays(connectedRelays);
        }
      }

      if (job.data.type === 'create-comment-event') {
        logger('Creating comment event');
      }
    }
  );

async function connectToRelays(
  relaysURLs: string[],
  options?: Partial<{ logger: typeof console.log }>
) {
  const { logger = console.log } = options ?? {};

  const relays = relaysURLs.map((url) => relayInit(url));

  const connectedRelays = await Promise.allSettled(
    relays.map(
      (relay) =>
        new Promise<Relay>(async (resolve, reject) => {
          try {
            await relay.connect();
            relay.on('connect', () => {
              logger(`connected ${relay.url}`);
              resolve(relay);
            });
            relay.on('error', () => {
              logger(`failed to connect to ${relay.url}`);
              reject();
            });
          } catch (error) {
            logger(`failed to connect to ${relay.url}`);
            reject();
          }
        })
    )
  ).then((relays) =>
    relays
      .filter((relay) => relay.status === 'fulfilled')
      .map((relay) => (relay.status === 'fulfilled' && relay.value) as Relay)
  );

  return connectedRelays;
}

function createStoryRootEvent(story: {
  canonical_url: string;
  url: string;
  title: string;
  author_name: string;
}) {
  const pubKey = getPublicKey(env.BOLTFUN_NOSTR_PRIVATE_KEY);

  let event = {
    kind: 1,
    pubkey: pubKey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['r', story.canonical_url],
      ['t', 'buildonbitcoin'],
    ],
    content: `${story.title}

Have a read and join the conversation 👇
    
author: ${story.author_name.slice(0, 20)} #BuildOnBitcoin 
    
Read story: ${story.url}`,
  } as Event;

  event.id = getEventHash(event);
  event.sig = signEvent(event, env.BOLTFUN_NOSTR_PRIVATE_KEY);

  return event;
}

async function publishEvent(
  event: Event,
  relays: Relay[],
  options?: Partial<{ logger: typeof console.log }>
) {
  const { logger = console.log } = options ?? {};

  return new Promise(async (resolve, reject) => {
    logger('publishing...');

    let publishedCount = 0;

    relays.forEach((relay) => {
      try {
        let pub = relay.publish(event);
        pub.on('ok', () => {
          logger(`event ${event.id!.slice(0, 5)}… published to ${relay.url}.`);
          publishedCount++;
        });
        pub.on('failed', (reason: string) => {
          logger(`failed to publish to ${relay.url}: ${reason}`);
        });
      } catch (error) {
        logger(error);
      }
    });
    setTimeout(() => {
      if (publishedCount !== 0) {
        resolve(`Published event to ${publishedCount} relays.`);
      } else {
        reject('Failed to publish event to any relay');
      }
    }, 3000);
  });
}

function closeRelays(relays: Relay[]) {
  return Promise.all(relays.map((relay) => relay.close()));
}

async function makeCallbackRequest(
  url: string,
  data: string | Record<any, any>
) {
  return axios.post(url, data, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(
        `${env.BF_SERVERLESS_SERVICE_USERNAME}:${env.BF_SERVERLESS_SERVICE_PASS}`
      ).toString('base64')}`,
    },
  });
}
