import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';

export const newConfigurationId = customAlphabet(alphabet, 10);
export const newShortId = customAlphabet(alphabet, 12);
const shortQuote = customAlphabet(alphabet, 8);

export const newQuoteId = () => `Q-${shortQuote()}`;
export const newOrderId = () => `O-${shortQuote()}`;
export const newEventId = () => newShortId();
export const newSessionJti = () => newShortId();
export const newCustomerId = () => `c_${newShortId()}`;
