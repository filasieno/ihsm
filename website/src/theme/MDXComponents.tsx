import MDXComponents from '@theme-original/MDXComponents';
import InteractiveTutorial from '../components/InteractiveTutorial';

export default {
	...MDXComponents,
	InteractiveTutorial,
} satisfies typeof MDXComponents & {
	InteractiveTutorial: typeof InteractiveTutorial;
};
