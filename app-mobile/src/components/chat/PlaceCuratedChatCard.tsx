import React from 'react';
import { Dimensions, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '../ui/Icon';
import { colors, fontWeights } from '../../constants/designSystem';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
type Props = { title: string; category?: string | null; image?: string | null; stopCount?: number; senderNote?: string; lockedAt?: string; isMe: boolean; hint: string; onPress: () => void };

/** Exact extraction of the accepted legacy place/curated chat bubble. */
export function PlaceCuratedChatCard({ title, category, image, stopCount, senderNote, lockedAt, isMe, hint, onPress }: Props) {
  return <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.cardBubbleContainer}>
    {senderNote ? <View style={styles.senderNote}><Text style={[styles.senderNoteText,isMe?styles.textSent:styles.textReceived]}>{senderNote}</Text></View> : null}
    {lockedAt ? <View style={styles.cardBubbleLockedBanner}><Icon name="lock-closed" size={12} color="#fff" /><Text style={styles.cardBubbleLockedBannerText} numberOfLines={1}>
      {`Locked in · ${new Date(lockedAt).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`}
    </Text></View> : null}
    <View style={styles.cardBubbleImageWrap}>
      {image ? <Image source={{uri:image}} style={styles.cardBubbleImage} resizeMode="cover"/> : <View style={[styles.cardBubbleImage,styles.cardBubblePlaceholder]}><Icon name="bookmark" size={24} color={isMe?'rgba(255,255,255,0.7)':colors.text.tertiary}/></View>}
      {stopCount ? <View style={styles.cardBubbleIntentChip}><Icon name="arrow-forward" size={10} color="#fff"/><Text style={styles.cardBubbleIntentChipText} numberOfLines={1}>{`${stopCount} stops`}</Text></View> : null}
    </View>
    <View style={styles.cardBubbleBody}>
      <Text style={[styles.cardBubbleTitle,isMe?styles.textSent:styles.textReceived]} numberOfLines={2}>{title}</Text>
      {category?<View style={styles.cardBubbleChip}><Text style={styles.cardBubbleChipText} numberOfLines={1}>{category}</Text></View>:null}
      <Text style={[styles.cardBubbleHint,isMe?styles.textSent:styles.textReceived]}>{hint}</Text>
    </View>
  </TouchableOpacity>;
}
export const placeCuratedChatCardStyles=StyleSheet.create({
  cardBubbleContainer:{width:SCREEN_WIDTH*0.6,borderRadius:12,overflow:'hidden',backgroundColor:'rgba(255,255,255,0.06)'},
  cardBubbleImage:{width:'100%',aspectRatio:16/10,backgroundColor:'rgba(0,0,0,0.08)'},cardBubbleImageWrap:{position:'relative'},cardBubblePlaceholder:{alignItems:'center',justifyContent:'center'},
  cardBubbleBody:{padding:10,gap:4},cardBubbleTitle:{fontSize:14,fontWeight:fontWeights.semibold},
  cardBubbleChip:{alignSelf:'flex-start',paddingHorizontal:8,paddingVertical:2,borderRadius:999,backgroundColor:'rgba(255,255,255,0.12)',marginTop:2},
  cardBubbleChipText:{fontSize:11,color:'rgba(255,255,255,0.85)'},cardBubbleHint:{fontSize:11,opacity:0.7,marginTop:2},
  cardBubbleIntentChip:{position:'absolute',top:8,right:8,flexDirection:'row',alignItems:'center',gap:3,paddingHorizontal:8,paddingVertical:4,borderRadius:999,backgroundColor:'rgba(0,0,0,0.55)'},
  cardBubbleIntentChipText:{fontSize:11,fontWeight:fontWeights.semibold,color:'#fff'},
  cardBubbleLockedBanner:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:10,paddingVertical:6,backgroundColor:'hsl(28, 80%, 45%)'},
  cardBubbleLockedBannerText:{flex:1,fontSize:12,fontWeight:fontWeights.semibold,color:'#fff'},
  senderNote:{paddingHorizontal:10,paddingVertical:6},senderNoteText:{fontSize:12},textSent:{color:colors.text.inverse},textReceived:{color:colors.text.primary},
});
const styles=placeCuratedChatCardStyles;
