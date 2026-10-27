#pragma once
#include "BTNode.h"

UCLASS()
class URepeatNode : public UBTNode
{
	GENERATED_BODY()
	int32 Counter = 0;
protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		if (Children.Num() == 0) return EBTNodeStatus::Failure;
		int32 Count = Parameters.Contains(TEXT("count")) ? FCString::Atoi(*Parameters[TEXT("count")]) : 3;
		EBTNodeStatus Status = Children[0]->Tick(Bb);
		if (Status == EBTNodeStatus::Running) return EBTNodeStatus::Running;
		Counter++;
		if (Counter >= Count) { Counter = 0; return Status; }
		return EBTNodeStatus::Running;
	}
};
