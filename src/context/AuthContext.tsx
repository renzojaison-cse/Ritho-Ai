import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  confirmPasswordReset,
  verifyPasswordResetCode,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  handleFirestoreError,
  OperationType,
  getAuthErrorMessage,
  User,
  testConnection,
} from '../lib/firebase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, pass: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resetPassword: (code: string, newPass: string) => Promise<void>;
  changePassword: (currentPass: string, newPass: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  updateProfileSettings: (data: Partial<UserProfile>) => Promise<void>;
  isGoogleUser: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthError = () => setAuthError(null);

  // Check connection on boot
  useEffect(() => {
    testConnection();
  }, []);

  // Monitor auth state changes and process redirect results
  useEffect(() => {
    // Check if user is returning from a redirect sign-in
    getRedirectResult(auth)
      .then(async (credential) => {
        if (credential?.user) {
          const userDocRef = doc(db, 'users', credential.user.uid);
          const snap = await getDoc(userDocRef);
          if (!snap.exists()) {
            const newProfile: UserProfile = {
              userId: credential.user.uid,
              email: credential.user.email || '',
              displayName: credential.user.displayName || credential.user.email?.split('@')[0] || 'Habit Achiever',
              photoURL: credential.user.photoURL || '',
              level: 1,
              xp: 100,
              dailyGoalTime: '08:00',
              soundEnabled: true,
              notificationsEnabled: true,
              theme: 'sage-garden',
              onboarded: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          }
        }
      })
      .catch((err: unknown) => {
        const code = (err as { code?: string })?.code || '';
        if (code && code !== 'auth/popup-closed-by-user') {
          setAuthError(getAuthErrorMessage(code));
        }
      });

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userDocRef);

          if (userSnap.exists()) {
            setProfile(userSnap.data() as UserProfile);
          } else {
            // Create default profile for first time user
            const newProfile: UserProfile = {
              userId: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Habit Achiever',
              photoURL: currentUser.photoURL || '',
              level: 1,
              xp: 50,
              dailyGoalTime: '08:00',
              soundEnabled: true,
              notificationsEnabled: true,
              theme: 'sage-garden',
              onboarded: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          }
        } catch (err) {
          console.error('Error fetching/creating user profile:', err);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithEmail = async (email: string, pass: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const msg = getAuthErrorMessage(code);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const registerWithEmail = async (name: string, email: string, pass: string) => {
    setAuthError(null);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      if (credential.user) {
        await updateProfile(credential.user, { displayName: name.trim() });
        const userDocRef = doc(db, 'users', credential.user.uid);
        const newProfile: UserProfile = {
          userId: credential.user.uid,
          email: credential.user.email || email.trim(),
          displayName: name.trim(),
          photoURL: '',
          level: 1,
          xp: 100, // Welcome bonus XP!
          dailyGoalTime: '08:00',
          soundEnabled: true,
          notificationsEnabled: true,
          theme: 'sage-garden',
          onboarded: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await setDoc(userDocRef, newProfile);
        setProfile(newProfile);
        try {
          await sendEmailVerification(credential.user);
        } catch {
          // Verification email sending failure is non-fatal on registration
        }
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const msg = getAuthErrorMessage(code);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const loginWithGoogle = async () => {
    setAuthError(null);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      if (credential.user) {
        const userDocRef = doc(db, 'users', credential.user.uid);
        const snap = await getDoc(userDocRef);
        if (!snap.exists()) {
          const newProfile: UserProfile = {
            userId: credential.user.uid,
            email: credential.user.email || '',
            displayName: credential.user.displayName || credential.user.email?.split('@')[0] || 'Habit Achiever',
            photoURL: credential.user.photoURL || '',
            level: 1,
            xp: 100,
            dailyGoalTime: '08:00',
            soundEnabled: true,
            notificationsEnabled: true,
            theme: 'sage-garden',
            onboarded: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await setDoc(userDocRef, newProfile);
          setProfile(newProfile);
        }
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        return; // User intentionally cancelled
      }
      if (code === 'auth/popup-blocked') {
        // Fallback to redirect sign-in if popup is blocked in iframe/browser
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr: unknown) {
          const rCode = (redirectErr as { code?: string })?.code || '';
          const msg = getAuthErrorMessage(rCode);
          setAuthError(msg);
          throw new Error(msg);
        }
      }
      const msg = getAuthErrorMessage(code);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setProfile(null);
      clearAuthError();
    } catch (err) {
      console.error('Error during sign out:', err);
    }
  };

  const sendPasswordReset = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const msg = getAuthErrorMessage(code);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const resetPassword = async (code: string, newPass: string) => {
    setAuthError(null);
    try {
      await verifyPasswordResetCode(auth, code);
      await confirmPasswordReset(auth, code, newPass);
    } catch (err: unknown) {
      const codeErr = (err as { code?: string })?.code || '';
      const msg = getAuthErrorMessage(codeErr);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const changePassword = async (currentPass: string, newPass: string) => {
    setAuthError(null);
    if (!auth.currentUser || !auth.currentUser.email) {
      throw new Error('No authenticated user session found.');
    }
    try {
      // Reauthenticate user first
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPass);
      await reauthenticateWithCredential(auth.currentUser, credential);
      // Perform password update
      await updatePassword(auth.currentUser, newPass);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const msg = getAuthErrorMessage(code);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const resendVerification = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const updateProfileSettings = async (data: Partial<UserProfile>) => {
    if (!user) return;
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const updatePayload = {
        ...data,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(userDocRef, updatePayload);
      setProfile((prev) => (prev ? { ...prev, ...updatePayload } : null));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const isGoogleUser = Boolean(
    user?.providerData?.some((p) => p.providerId === 'google.com')
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authError,
        clearAuthError,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        logout,
        sendPasswordReset,
        resetPassword,
        changePassword,
        resendVerification,
        updateProfileSettings,
        isGoogleUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
