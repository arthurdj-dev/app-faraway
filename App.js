import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  Dimensions,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import TabBar from './src/components/TabBar';
import NewGame from './src/screens/NewGame';
import History from './src/screens/History';
import Stats from './src/screens/Stats';
import { COLORS } from './src/constants/theme';

const { width } = Dimensions.get('window');
const TABS = ['Nouvelle partie', 'Historique', 'Statistiques'];

function AppContent() {
  const [activeTab, setActiveTab] = useState(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  const handleTabPress = (index) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setActiveTab(index);
  };

  const handleScroll = (e) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveTab(index);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <TabBar tabs={TABS} activeTab={activeTab} onTabPress={handleTabPress} />
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={styles.carousel}
      >
        <View style={{ width }}>
          <NewGame />
        </View>
        <View style={{ width }}>
          <History isActive={activeTab === 1} />
        </View>
        <View style={{ width }}>
          <Stats isActive={activeTab === 2} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  carousel: {
    flex: 1,
  },
});
