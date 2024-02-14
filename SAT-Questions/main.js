import information from './information-ideas.json' assert { type: 'json' };
import craft from './craft-structure.json' assert { type: 'json' };
import expression from './expression-ideas.json' assert { type: 'json' };
import standards from './standard-conventions.json' assert { type: 'json' };
const questionTypes = [information,craft,expression,standards];
const domains = ["Information","Craft","Expression","Standards"];
var json =  '';
var domain = "";
var roll = 0;
document.getElementById('Rationale').style.visibility = 'hidden';
document.getElementById('nextquestion').disabled=true;
document.getElementById('submit').disabled=true;
var selectedAnswer =""
const radios = document.querySelectorAll('input[name="answer"]');
radios.forEach(radio => {
radio.addEventListener('click', function () {
    document.getElementById('submit').disabled=false;
    selectedAnswer = radio.id;
});
});


function buildQuestion(){
    document.getElementById('questionDiv').style.display = 'block';
    document.getElementById('Rationale').style.visibility = 'hidden';
    document.getElementById('nextquestion').disabled=true;
    document.getElementById('Question').innerHTML=json[roll].Question
    document.getElementById('A Button').innerHTML=json[roll].A;
    document.getElementById('B Button').innerHTML=json[roll].B;
    document.getElementById('C Button').innerHTML=json[roll].C;
    document.getElementById('D Button').innerHTML=json[roll].D;
    
}


export function submit(){
    document.getElementById('A').disabled=true;
    document.getElementById('B').disabled=true;
    document.getElementById('C').disabled=true;
    document.getElementById('D').disabled=true;
    document.getElementById('submit').disabled=true;
    console.log(selectedAnswer);
    if(selectedAnswer==json[roll].Answer){
        console.log("Correct!")
        writeScore(1,domain);
    }
    else{
        writeScore(0,domain);
    }
    document.getElementById('Rationale').style.visibility = 'visible';
    document.getElementById('nextquestion').disabled=false;
    document.getElementById('Rationale').innerHTML = json[roll].Rationale;
    
}

export function nextQuestion(){
    var found = false;
    //pull appropiate domain/difficultys
    var pulledData = getQuestionData();
    console.log(pulledData);
    //set domain globally
    var domainRoll = Number(pulledData[0]);
    console.log(domainRoll);
    domain = domains[domainRoll];
    json = questionTypes[domainRoll];
    console.log(json);
    while(!found){
        roll = Math.floor(Math.random()*json.length);
        if(json[roll].Difficulty==pulledData[1]){
            found=true;
        }
    }

    buildQuestion();
    document.getElementById('A').disabled=false;
    document.getElementById('B').disabled=false;
    document.getElementById('C').disabled=false;
    document.getElementById('D').disabled=false;

    document.getElementById('A').checked=false;
    document.getElementById('B').checked=false;
    document.getElementById('C').checked=false;
    document.getElementById('D').checked=false;

}
window.submit = submit;
window.nextQuestion = nextQuestion;