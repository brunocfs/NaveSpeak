import { NameStyleDemo, ProfileBannerDemo, SpeakingRingDemo, AnimatedAvatarDemo } from './ProfileDemos.jsx';
import { HdScreenDemo, MediaPopoutDemo, ExtraBackgroundsDemo, GhostVoiceDemo } from './MediaDemos.jsx';
import { BigUploadsDemo, LongMessagesDemo, PersonalSoundsDemo, JoinSoundDemo, ServerPerksDemo } from './FlowDemos.jsx';

// Uma demo animada (React + CSS) por chave de TURBO_BENEFITS.
export const DEMOS = {
  nameStyle: NameStyleDemo,
  hdScreen: HdScreenDemo,
  bigUploads: BigUploadsDemo,
  mediaPopout: MediaPopoutDemo,
  ghostVoice: GhostVoiceDemo,
  profileBanner: ProfileBannerDemo,
  speakingRing: SpeakingRingDemo,
  extraBackgrounds: ExtraBackgroundsDemo,
  animatedAvatar: AnimatedAvatarDemo,
  longMessages: LongMessagesDemo,
  personalSounds: PersonalSoundsDemo,
  joinSound: JoinSoundDemo,
  serverPerks: ServerPerksDemo,
};
