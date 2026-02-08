import {
    amber,
    blue,
    crimson,
    cyan,
    grass,
    indigo,
    orange,
    plum,
    purple,
    red,
    teal,
    tomato,
    violet,
} from '@radix-ui/colors';

const PALETTE = [
    crimson,
    indigo,
    teal,
    amber,
    grass,
    plum,
    cyan,
    orange,
    blue,
    tomato,
    violet,
    purple,
];

// Consistent hashing function
function djb2(str: string) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash >>> 0;
}

export function getUserColor(userId: string) {
    const hash = djb2(userId);
    const index = hash % PALETTE.length;
    // Radix colors are objects like { crimson1: '...', crimson2: '...', ... }
    // We return the whole object so components can pick shades
    return PALETTE[index];
}

export function getUserColorName(userId: string) {
    const hash = djb2(userId);
    const index = hash % PALETTE.length;
    // Extract the name from the object key (e.g. 'crimson1' -> 'crimson')
    const colorObj = PALETTE[index];
    const key = Object.keys(colorObj)[0];
    return key.replace('1', '');
}
