// Anglais : mêmes parties que le français (i18n/fr/index.ts)
import type fr from '../fr';
import type { Translation } from '../types';
import account from './account';
import admin from './admin';
import agenda from './agenda';
import auth from './auth';
import common from './common';
import journal from './journal';
import messages from './messages';
import platform from './platform';
import residents from './residents';
import schedule from './schedule';
import shell from './shell';

export default { common, auth, shell, journal, residents, agenda, schedule, messages, admin, account, platform } satisfies Translation<typeof fr>;
