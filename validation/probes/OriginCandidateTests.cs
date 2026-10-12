using System;
class OriginCandidateTests {
    static int failed;
    static void Check(string name,string actual,string expected) {
        bool ok=actual==expected;
        Console.WriteLine((ok?"PASS ":"FAIL ")+name+": actual="+actual+", expected="+expected);
        if(!ok) failed++;
    }
    static int Main() {
        InputOriginCandidate shortClick=new InputOriginCandidate();
        shortClick.MouseDown(0,false,false);
        Check("short maximize click",shortClick.Resolve(5),"nearby-mouse");
        InputOriginCandidate longDrag=new InputOriginCandidate();
        longDrag.MouseDown(0,false,true); longDrag.BeginMoveSize(5);
        Check("long caption drag remains associated at 2500ms",longDrag.Resolve(2500),"drag-mouse");
        longDrag.EndMoveSize();
        Check("drag association ends on completion",longDrag.Resolve(3000),"unknown");
        InputOriginCandidate unrelated=new InputOriginCandidate();
        unrelated.MouseDown(0,false,false); unrelated.BeginMoveSize(5);
        Check("unrelated click does not establish caption drag",unrelated.Resolve(2500),"unknown");
        InputOriginCandidate injected=new InputOriginCandidate();
        injected.MouseDown(0,true,true); injected.BeginMoveSize(5);
        Check("injected drag is excluded",injected.Resolve(2500),"unknown");
        InputOriginCandidate conflict=new InputOriginCandidate();
        conflict.MouseDown(0,false,true); conflict.BeginMoveSize(5); conflict.KeyDown(100,false);
        Check("competing key makes active drag ambiguous",conflict.Resolve(110),"unknown");
        InputOriginCandidate key=new InputOriginCandidate(); key.KeyDown(0,false);
        Check("short shortcut event",key.Resolve(8),"nearby-key");
        WindowStateSequence crossings=new WindowStateSequence();
        crossings.Observe(1,0,"initial"); crossings.BeginMoveSize();
        int count=0;
        foreach(int screen in new int[]{1,0,1,0,1}) {
            if(crossings.Observe(1,screen,"state-change")!=null) count++;
        }
        Check("intermediate crossings do not count as moves",count.ToString(),"0");
        crossings.EndMoveSize();
        WindowTransition end=crossings.Observe(1,1,"move-size-end");
        Check("one finished drag records one move",end==null?"none":end.Operation,"monitor-move-ended");
        Check("final comparison uses start and end screens",end==null?"none":end.BeforeMonitor+"->"+end.AfterMonitor,"0->1");
        Check("repeat observation is deduplicated",crossings.Observe(1,1,"state-change")==null?"none":"record","none");
        WindowStateSequence returns=new WindowStateSequence();
        returns.Observe(1,0,"initial"); returns.BeginMoveSize(); returns.Observe(1,1,"state-change"); returns.EndMoveSize();
        Check("drag ending on original monitor does not count",returns.Observe(1,0,"move-size-end")==null?"none":"record","none");
        return failed==0?0:1;
    }
}
