import type { Metadata } from 'next';
import Handbook from './handbook';
export const metadata: Metadata={title:'Signal Desk Product Handbook',description:'A practical guide to startup discovery, reviewed outreach, relationship CRM and application tracking in Signal Desk.',openGraph:{title:'Signal Desk Product Handbook',description:'Features, workflows, onboarding and operating guidance for the Signal Desk pilot.'}};
export default function GuidePage(){return <Handbook/>;}
