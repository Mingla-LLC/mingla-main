import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '../ui/Icon';

type Props = { title: string; category?: string | null; image?: string | null; stopCount?: number; senderNote?: string; lockedAt?: string; onPress: () => void };

/** One visual contract for historical saved-card bubbles and new native snapshots. */
export function PlaceCuratedChatCard({ title, category, image, stopCount, senderNote, lockedAt, onPress }: Props) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onPress} activeOpacity={0.85} style={styles.card}>
    {senderNote ? <View style={styles.note}><Text style={styles.noteText}>{senderNote}</Text></View> : null}
    {lockedAt ? <View style={styles.locked}><Icon name="lock-closed" size={12} color="#fff" /><Text style={styles.lockedText} numberOfLines={1}>
      {`Locked in · ${new Date(lockedAt).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`}
    </Text></View> : null}
    <View style={styles.media}>
      {image ? <Image source={{ uri: image }} style={styles.image} resizeMode="cover" /> : <View style={[styles.image, styles.placeholder]}><Icon name="bookmark" size={24} color="#6B7280" /></View>}
      {stopCount ? <View style={styles.stopChip}><Text style={styles.stopText}>{stopCount} stops</Text></View> : null}
    </View>
    <View style={styles.body}>
      <Text style={styles.title} numberOfLines={2}>{title}</Text>
      {category ? <View style={styles.chip}><Text style={styles.chipText} numberOfLines={1}>{category}</Text></View> : null}
      <Text style={styles.hint}>Tap to view details</Text>
    </View>
  </TouchableOpacity>;
}
const styles=StyleSheet.create({
  card:{width:240,borderRadius:14,overflow:'hidden',backgroundColor:'#fff',borderWidth:1,borderColor:'rgba(17,24,39,.12)'},
  note:{paddingHorizontal:12,paddingVertical:9,backgroundColor:'#FFF7ED'},noteText:{fontSize:13,color:'#7C2D12'},
  locked:{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:10,paddingVertical:7,backgroundColor:'#9A3412'},lockedText:{flex:1,fontSize:11,fontWeight:'700',color:'#fff'},
  media:{position:'relative'},image:{width:'100%',aspectRatio:16/10},placeholder:{alignItems:'center',justifyContent:'center',backgroundColor:'#F3F4F6'},
  stopChip:{position:'absolute',right:8,bottom:8,borderRadius:999,paddingHorizontal:8,paddingVertical:4,backgroundColor:'rgba(0,0,0,.72)'},stopText:{fontSize:11,fontWeight:'700',color:'#fff'},
  body:{padding:12},title:{fontSize:16,fontWeight:'700',color:'#111827'},chip:{alignSelf:'flex-start',marginTop:7,borderRadius:999,paddingHorizontal:8,paddingVertical:3,backgroundColor:'#FFF0E5'},chipText:{fontSize:11,fontWeight:'600',color:'#9A3412'},hint:{marginTop:8,fontSize:11,color:'#6B7280'},
});
