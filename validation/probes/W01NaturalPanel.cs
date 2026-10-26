// Manual operator panel. No hooks, input synthesis, window enumeration or title reads.
using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;

class W01NaturalPanel {
    class ToolPanel : Form {
        protected override CreateParams CreateParams { get { var p=base.CreateParams;p.ExStyle|=0x80;return p; } }
    }
    static string directory,lastStatus; static int sequence; static bool programPending;
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static ComboBox kind,application,state,scenario; static CheckBox paused; static Button arm,finish,cancel;
    static Label status; static TextBox results; static Form b;
    static void Send(string action) {
        var command=new {sequence=++sequence,action,plan=new {kind=(string)kind.SelectedItem,application=(string)application.SelectedItem,
            state=(string)state.SelectedItem,paused=paused.Checked,scenario=(string)scenario.SelectedItem}};
        string target=Path.Combine(directory,"control.json"),temp=Path.Combine(directory,"control-panel.tmp");
        File.WriteAllText(temp,Json.Serialize(command));
        if(File.Exists(target))File.Replace(temp,target,null);else File.Move(temp,target);
    }
    static ComboBox Choice(string[] values,int x,int y,Form form) {
        var box=new ComboBox {Left=x,Top=y,Width=145,DropDownStyle=ComboBoxStyle.DropDownList};
        box.Items.AddRange(values);box.SelectedIndex=0;form.Controls.Add(box);return box;
    }
    static Form Target(string alias,int x,int y) {
        var f=new Form {Text="W01 target "+alias,Width=450,Height=320,StartPosition=FormStartPosition.Manual,Location=new Point(x,y)};
        f.Controls.Add(new Label {Dock=DockStyle.Fill,Text=alias+"\n\nDirect click: visible client of a different window.\nAlt+Tab: select a different window, release Alt.\nAfter input, wait 3s then FINISH.",Font=new Font("Segoe UI",13),Padding=new Padding(20)});
        f.FormClosing+=(s,e)=>{if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;f.Hide();}};return f;
    }
    [STAThread] static int Main(string[] args) {
        if(args.Length!=1||!Directory.Exists(args[0]))return 2;directory=args[0];Application.EnableVisualStyles();
        var form=new ToolPanel {Text="W01 manual ARM / FINISH",Width=670,Height=620,ShowInTaskbar=false,
            MaximizeBox=false,StartPosition=FormStartPosition.Manual,Location=new Point(10,10)};
        form.Controls.Add(new Label {Left=15,Top=10,Width=630,Height=105,Text=
            "Choose kind/scenario and state. ARM starts a 4s countdown with hooks OFF.\nWithin 4s click the SOURCE window, then release all keys/buttons.\nWait until ARMED + 2s. Perform ONE operation. Wait 3s, click FINISH.\nPanel is excluded (tool window). CANCEL for an unperformed trial.\n45s deadline invalidates the trial. Close panel to stop helper and exit.\nProgram scenario: B activates automatically 2s after ARMED; do not input."});
        kind=Choice(new[]{"mouse","key","negative"},15,120,form);
        application=Choice(new[]{"standard","chrome"},175,120,form);
        state=Choice(new[]{"learning","mastered","excluded"},335,120,form);
        paused=new CheckBox {Text="Pause notices",Left=495,Top=122,Width=140};form.Controls.Add(paused);
        scenario=Choice(new[]{"direct","alt-tab","multi-tab","escape","return","same-window","program","taskbar-click","win-digit","switcher-mouse","owner","edge-tab"},15,160,form);
        arm=new Button {Text="ARM (4s)",Left=175,Top=155,Width=145};
        finish=new Button {Text="FINISH (performed)",Left=335,Top=155,Width=170,Enabled=false};
        cancel=new Button {Text="CANCEL",Left=515,Top=155,Width=120,Enabled=false};
        form.Controls.AddRange(new Control[]{arm,finish,cancel});
        arm.Click+=(s,e)=>{arm.Enabled=false;status.Text="COUNTDOWN: choose source within 4s; hooks OFF";Send("arm");};
        finish.Click+=(s,e)=>{finish.Enabled=cancel.Enabled=false;Send("finish");};
        cancel.Click+=(s,e)=>{finish.Enabled=cancel.Enabled=false;Send("cancel");};
        status=new Label {Left=15,Top=200,Width=630,Height=45,Text="Waiting for product READY"};form.Controls.Add(status);
        results=new TextBox {Left=15,Top=245,Width=630,Height=285,Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical};form.Controls.Add(results);
        var a=Target("A",690,50); b=Target("B",910,260);var c=Target("C",700,470);
        var show=new Button {Text="Show A/B/C (idle only)",Left=15,Top=540,Width=200};
        show.Click+=(s,e)=>{a.Show();b.Show();c.Show();};form.Controls.Add(show);
        var owner=new Button {Text="Show owned popup (idle)",Left=240,Top=540,Width=200};
        var popup=Target("owned popup",900,100);owner.Click+=(s,e)=>popup.Show(a);form.Controls.Add(owner);
        var program=new Timer {Interval=2000};program.Tick+=(s,e)=>{program.Stop();b.Activate();};
        var timer=new Timer {Interval=250};timer.Tick+=(s,e)=>{
            try {
                string text=File.ReadAllText(Path.Combine(directory,"status.json"));if(text==lastStatus)return;lastStatus=text;
                var value=Json.Deserialize<Dictionary<string,object>>(text);string current=(string)value["state"];
                int ack=Convert.ToInt32(value["sequence"]);bool error=(bool)value["error"];
                if(ack>=sequence){
                    status.Text=current+(error?" - ERROR: stop and report":"")+" | trials: "+((System.Collections.ICollection)value["results"]).Count;
                    arm.Enabled=current=="IDLE"&&!error;finish.Enabled=cancel.Enabled=current=="ARMED";
                    show.Enabled=owner.Enabled=current=="IDLE";
                    if(current=="ARMED"&&!programPending&&(string)scenario.SelectedItem=="program"){programPending=true;program.Start();}
                    if(current!="ARMED"){programPending=false;program.Stop();}
                }
                results.Text=Json.Serialize(value["results"]);if(current=="CLOSED")form.Close();
            }catch{}
        };
        form.FormClosing+=(s,e)=>{timer.Stop();program.Stop();try{Send("end");}catch{}};
        form.Shown+=(s,e)=>{a.Show();b.Show();c.Show();timer.Start();};Application.Run(form);
        a.Dispose();b.Dispose();c.Dispose();popup.Dispose();timer.Dispose();program.Dispose();return 0;
    }
}
