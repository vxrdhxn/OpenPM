'use client';

import { createContext, useContext } from 'react';

/** The signed-in user, as GET /profile/me returns them. */
export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
}

const MeContext = createContext<Me | null>(null);

/**
 * The signed-in app's layout loads the user once and provides it here, so pages read it instead of
 * each asking the API again (it only renders its pages once the user is loaded).
 */
export const MeProvider = MeContext.Provider;

/** The signed-in user. Null only outside the signed-in layout. */
export const useMe = () => useContext(MeContext);

/** Owners and admins: who may manage people, labels and settings, and use the admin area. */
export const isManagerRole = (role: string | undefined) => role === 'owner' || role === 'admin';
